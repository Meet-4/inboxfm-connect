import * as crypto from 'crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActivepiecesError } from '@inboxfm-connect/core-utils'
import { EncryptedObject, encryptUtils } from '../../../../src/app/helper/encryption'

// The key shape .env.tests ships — a 32-hex-CHARACTER string. Under both the
// legacy and the fixed key derivation this shape is used as 32 raw latin1
// bytes (it is deliberately NOT hex-decoded, which would produce 16 bytes).
const LEGACY_32_CHAR_KEY = '7e19fad4c13eaea8f657afb12e8f9c40'

// A full 32-byte hex key (`openssl rand -hex 32`). Before the derivation fix
// this shape was treated as 64 raw bytes and crashed `createCipheriv` with
// "Invalid key length" on first use.
const HEX_64_CHAR_KEY = 'c7259b9050e3d78dddb6dca27b1187c46853a178d1a822d8feedac2810dd45d8'

// Ciphertext produced by the OLD code path (key = Buffer.from(secret,
// 'binary'), aes-256-cbc, hex output) for LEGACY_32_CHAR_KEY and a fixed IV.
// Hardcoded so no future refactor of the helper or of the legacy replication
// below can silently redefine "legacy" behavior: the current code MUST keep
// decrypting this exact vector.
const FROZEN_LEGACY_CIPHERTEXT: EncryptedObject = {
    iv: '00112233445566778899aabbccddeeff',
    data: '5a7597325bb547e7d2942d2bcff544e7e03a7bf9a65bdbfebd9353ba9831af1c',
}
const FROZEN_LEGACY_PLAINTEXT = 'activepieces-back-compat-vector'

/**
 * Replicates the pre-fix encryption scheme verbatim: the key is
 * `Buffer.from(secret, 'binary')` — i.e. the secret's characters used as raw
 * latin1 bytes. Ciphertexts this produces are the ground truth the fixed
 * implementation must remain able to decrypt.
 */
function legacyEncryptString(secret: string, plaintext: string): EncryptedObject {
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(secret, 'binary'), iv)
    let encrypted = cipher.update(plaintext, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    return {
        iv: iv.toString('hex'),
        data: encrypted,
    }
}

const ORIGINAL_KEY = process.env.AP_ENCRYPTION_KEY

function setEncryptionKey(key: string): void {
    process.env.AP_ENCRYPTION_KEY = key
}

function expectNamedSystemPropError(promise: Promise<unknown>): Promise<void> {
    return expect(promise).rejects.toMatchObject({
        error: {
            code: 'SYSTEM_PROP_INVALID',
        },
    })
}

afterEach(() => {
    if (ORIGINAL_KEY !== undefined) {
        process.env.AP_ENCRYPTION_KEY = ORIGINAL_KEY
    }
    vi.restoreAllMocks()
})

describe('encryptUtils — AES key derivation back-compat matrix', () => {
    describe('legacy 32-character keys (back-compat, non-negotiable)', () => {
        it('decrypts a ciphertext produced by the OLD code path', async () => {
            setEncryptionKey(LEGACY_32_CHAR_KEY)

            const plaintext = 'round-tripped-through-legacy-encrypt'
            const legacyEncrypted = legacyEncryptString(LEGACY_32_CHAR_KEY, plaintext)

            const decrypted = await encryptUtils.decryptString(legacyEncrypted)

            expect(decrypted).toBe(plaintext)
        })

        it('decrypts the frozen legacy ciphertext vector', async () => {
            setEncryptionKey(LEGACY_32_CHAR_KEY)

            const decrypted = await encryptUtils.decryptString(FROZEN_LEGACY_CIPHERTEXT)

            expect(decrypted).toBe(FROZEN_LEGACY_PLAINTEXT)
        })

        it('round-trips through the current encrypt/decrypt implementation', async () => {
            setEncryptionKey(LEGACY_32_CHAR_KEY)

            const encrypted = await encryptUtils.encryptString(FROZEN_LEGACY_PLAINTEXT)
            const decrypted = await encryptUtils.decryptString(encrypted)

            expect(decrypted).toBe(FROZEN_LEGACY_PLAINTEXT)
        })

        it('treats a 32-character key as raw bytes even when it is not valid hex', async () => {
            // The crypto layer historically accepted ANY 32 characters as
            // 32 raw bytes (the startup validator separately asks for
            // alphanumerics). Hex-decoding 32-char keys would both change
            // key material and break existing deployments.
            const nonHexKey = 'z'.repeat(32)
            setEncryptionKey(nonHexKey)

            const legacyEncrypted = legacyEncryptString(nonHexKey, 'non-hex-legacy-key')
            const decrypted = await encryptUtils.decryptString(legacyEncrypted)

            expect(decrypted).toBe('non-hex-legacy-key')
        })
    })

    describe('64-character hex keys (openssl rand -hex 32)', () => {
        it('round-trips a value encrypted under a 64-char hex key', async () => {
            setEncryptionKey(HEX_64_CHAR_KEY)

            const encrypted = await encryptUtils.encryptString('sixty-four-hex-chars')
            const decrypted = await encryptUtils.decryptString(encrypted)

            expect(decrypted).toBe('sixty-four-hex-chars')
        })

        it('derives the key by hex-decoding, not by using the characters as bytes', async () => {
            setEncryptionKey(HEX_64_CHAR_KEY)

            // Encrypt with the helper, then decrypt manually with
            // Buffer.from(key, 'hex'). That only yields the plaintext if the
            // helper derived the same 32-byte key; using the 64 characters as
            // raw bytes would produce a different key (and crash).
            const encrypted = await encryptUtils.encryptString('hex-decoded-equivalence')
            const decipher = crypto.createDecipheriv(
                'aes-256-cbc',
                Buffer.from(HEX_64_CHAR_KEY, 'hex'),
                Buffer.from(encrypted.iv, 'hex'),
            )
            let decrypted = decipher.update(encrypted.data, 'hex', 'utf8')
            decrypted += decipher.final('utf8')

            expect(decrypted).toBe('hex-decoded-equivalence')
        })

        it('round-trips objects for both key shapes', async () => {
            const payload = { secret: 'value', nested: { count: 42 } }

            for (const key of [LEGACY_32_CHAR_KEY, HEX_64_CHAR_KEY]) {
                setEncryptionKey(key)
                const encrypted = await encryptUtils.encryptObject(payload)
                const decrypted = await encryptUtils.decryptObject<typeof payload>(encrypted)
                expect(decrypted).toEqual(payload)
            }
        })
    })

    describe('wrong key shapes fail with a named error, not a crypto crash', () => {
        const badKeys = [
            ['31 characters', 'a'.repeat(31)],
            ['33 characters', 'a'.repeat(33)],
            ['63 hex characters (one short of a 32-byte key)', 'f'.repeat(63)],
            ['64 non-hex characters', 'g'.repeat(64)],
        ] as const

        it.each(badKeys)('encryptString rejects a key of %s', async (_label, badKey) => {
            setEncryptionKey(badKey)

            await expectNamedSystemPropError(encryptUtils.encryptString('anything'))
        })

        it.each(badKeys)('decryptString rejects a key of %s', async (_label, badKey) => {
            setEncryptionKey(badKey)

            await expectNamedSystemPropError(encryptUtils.decryptString({
                iv: FROZEN_LEGACY_CIPHERTEXT.iv,
                data: FROZEN_LEGACY_CIPHERTEXT.data,
            }))
        })

        it('decryptObject rejects a wrong-length key too', async () => {
            setEncryptionKey('a'.repeat(31))

            await expectNamedSystemPropError(encryptUtils.decryptObject({
                iv: FROZEN_LEGACY_CIPHERTEXT.iv,
                data: FROZEN_LEGACY_CIPHERTEXT.data,
            }))
        })

        it('exposes the error as an ActivepiecesError carrying the prop name', async () => {
            setEncryptionKey('a'.repeat(31))

            let caught: unknown
            try {
                await encryptUtils.encryptString('anything')
            }
            catch (error) {
                caught = error
            }

            expect(caught).toBeInstanceOf(ActivepiecesError)
            expect((caught as Error).message).toMatch(/AP_ENCRYPTION_KEY/)
        })
    })
})

describe('encryptUtils — missing encryption key guards', () => {
    it('decryptString rejects with the shared assertion error when the key is missing', async () => {
        vi.spyOn(encryptUtils, 'getEncryptionKey').mockResolvedValue(null)

        // Not a bare TypeError from Buffer.from(null): the decrypt paths now
        // carry the same assertNotNullOrUndefined guard the encrypt paths do.
        await expect(encryptUtils.decryptString(FROZEN_LEGACY_CIPHERTEXT))
            .rejects
            .toThrow('secret is null or undefined')
    })

    it('decryptObject rejects with the shared assertion error when the key is missing', async () => {
        vi.spyOn(encryptUtils, 'getEncryptionKey').mockResolvedValue(null)

        await expect(encryptUtils.decryptObject(FROZEN_LEGACY_CIPHERTEXT))
            .rejects
            .toThrow('secret is null or undefined')
    })

    it('encryptString keeps failing with the assertion error when the key is missing', async () => {
        vi.spyOn(encryptUtils, 'getEncryptionKey').mockResolvedValue(null)

        await expect(encryptUtils.encryptString('anything'))
            .rejects
            .toThrow('secret is null or undefined')
    })
})
