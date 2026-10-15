import * as crypto from 'crypto'
import { randomBytes } from 'node:crypto'
import { promisify } from 'util'

import { ActivepiecesError, ErrorCode, assertNotNullOrUndefined, isNil } from '@inboxfm-connect/core-utils'
import { Mutex } from 'async-mutex'
import { z } from 'zod'
import { RedisType } from '../database/redis/types'
import { redisConnections } from '../database/redis-connections'
import { localFileStore } from './local-store'
import { system } from './system/system'
import { AppSystemProp } from './system/system-props'

// SECURITY TRADE-OFF (documented deliberately — do not "fix" silently):
// aes-256-cbc is *unauthenticated* encryption: there is no HMAC/AEAD tag, so
// a ciphertext that is modified in storage decrypts without detection
// (CBC bit-flipping / padding attacks). This is an accepted trade-off for
// at-rest secret storage (app connection values, OAuth client secrets, AI
// provider keys): the threat model is exposure of the database — a DB dump
// must not yield usable secrets — not an attacker who can already rewrite
// rows inside the database (at that point the secrets are compromised via
// the running server anyway).
//
// Switching to an AEAD such as aes-256-gcm must NOT be done in place: it
// changes the ciphertext format, so every already-stored value would become
// undecryptable and the change would break all deployments at once. The
// migration path, if an owner decides authentication is worth the break:
// version-tag the envelope (e.g. `{ version: 2, iv, tag, data }`), encrypt
// new writes with GCM, decrypt version-1 (CBC) records via fallback, and
// lazily re-encrypt old rows on write.
const algorithm = 'aes-256-cbc'
const ivLength = 16
const mutexLock = new Mutex()

export const EncryptedObject = z.object({
    iv: z.string(),
    data: z.string(),
})
export type EncryptedObject = z.infer<typeof EncryptedObject>
const redisType = redisConnections.getRedisType()

// Exactly 64 hex characters — a 32-byte key encoded as hex.
const hexEncodedKeyRegex = /^[0-9a-fA-F]{64}$/

/**
 * Derives the raw 32-byte AES-256 key from the ENCRYPTION_KEY secret.
 *
 * Two key shapes are accepted:
 *
 * 1. 32 characters — used as 32 raw latin1 bytes. This is the legacy shape
 *    (`openssl rand -hex 16`); its key material is kept EXACTLY as before so
 *    that every ciphertext already stored under it keeps decrypting. It is
 *    deliberately NOT hex-decoded: decoding would yield 16 bytes, change the
 *    key material, and break every existing deployment's stored data.
 *
 * 2. 64 hex characters — decoded from hex into 32 bytes. This is the
 *    recommended shape (`openssl rand -hex 32`). Before this helper existed
 *    such keys were treated as 64 raw bytes and `createCipheriv` crashed
 *    with "Invalid key length" on first use.
 *
 * Any other shape fails with a named ActivepiecesError naming the prop,
 * instead of the crypto library's opaque "Invalid key length" RangeError.
 */
function deriveAesKey(secret: string): Buffer {
    if (secret.length === 32) {
        return Buffer.from(secret, 'binary')
    }
    if (hexEncodedKeyRegex.test(secret)) {
        return Buffer.from(secret, 'hex')
    }
    throw new ActivepiecesError(
        {
            code: ErrorCode.SYSTEM_PROP_INVALID,
            params: {
                prop: AppSystemProp.ENCRYPTION_KEY,
            },
        },
        `AP_ENCRYPTION_KEY must be a 32-character string (used as raw key bytes) or a 64-character hexadecimal string (e.g. openssl rand -hex 32); received a ${secret.length}-character value`,
    )
}

export const encryptUtils = {
    decryptString: async (encryptedObject: EncryptedObject): Promise<string> => {
        const secret = await encryptUtils.getEncryptionKey()
        assertNotNullOrUndefined(secret, 'secret')
        const iv = Buffer.from(encryptedObject.iv, 'hex')
        const key = deriveAesKey(secret)
        const decipher = crypto.createDecipheriv(algorithm, key, iv)
        let decrypted = decipher.update(encryptedObject.data, 'hex', 'utf8')
        decrypted += decipher.final('utf8')
        return decrypted
    },
    decryptObject: async <T>(encryptedObject: EncryptedObject): Promise<T> => {
        const secret = await encryptUtils.getEncryptionKey()
        assertNotNullOrUndefined(secret, 'secret')
        const iv = Buffer.from(encryptedObject.iv, 'hex')
        const key = deriveAesKey(secret)
        const decipher = crypto.createDecipheriv(algorithm, key, iv)
        let decrypted = decipher.update(encryptedObject.data, 'hex', 'utf8')
        decrypted += decipher.final('utf8')
        return JSON.parse(decrypted)
    },
    encryptObject: async (object: unknown): Promise<EncryptedObject> => {
        const objectString = JSON.stringify(object)
        return encryptUtils.encryptString(objectString)
    },
    encryptString: async (inputString: string): Promise<EncryptedObject> => {
        const secret = await encryptUtils.getEncryptionKey()
        assertNotNullOrUndefined(secret, 'secret')
        const iv = crypto.randomBytes(ivLength)
        const key = deriveAesKey(secret)
        const cipher = crypto.createCipheriv(algorithm, key, iv)
        let encrypted = cipher.update(inputString, 'utf8', 'hex')
        encrypted += cipher.final('hex')
        return {
            iv: iv.toString('hex'),
            data: encrypted,
        }
    },
    getEncryptionKey: async (): Promise<string | null> => {
        const secret = system.get(AppSystemProp.ENCRYPTION_KEY) ?? null
        if (!isNil(secret)) {
            return secret
        }
        if (redisType === RedisType.MEMORY) {
            return generateAndStoreSecret()
        }
        return null
    },
}


function generateAndStoreSecret(): Promise<string> {
    return mutexLock.runExclusive(async () => {
        const storedSecret = await localFileStore.load(AppSystemProp.ENCRYPTION_KEY)
        if (!isNil(storedSecret)) {
            return storedSecret
        }
        const secretLengthInBytes = 16
        const secretBuffer = await promisify(randomBytes)(secretLengthInBytes)
        const secret = secretBuffer.toString('hex')
        await localFileStore.save(AppSystemProp.ENCRYPTION_KEY, secret)
        return secret
    })
}
