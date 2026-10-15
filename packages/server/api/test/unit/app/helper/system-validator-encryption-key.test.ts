import { FastifyBaseLogger } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateEnvPropsOnStartup } from '../../../../src/app/helper/system-validator'

// The startup gate must accept every key shape the crypto layer derives a
// 32-byte AES key from: the legacy 32-character shape and the 64-character
// hex shape (openssl rand -hex 32). Before the fix only the legacy shape was
// accepted, so an operator who pasted a full 64-hex-char key was locked out
// at boot with a message that only mentioned the 32-char format.
const LEGACY_32_CHAR_KEY = '7e19fad4c13eaea8f657afb12e8f9c40'
const HEX_64_CHAR_KEY = 'c7259b9050e3d78dddb6dca27b1187c46853a178d1a822d8feedac2810dd45d8'

const ORIGINAL_KEY = process.env.AP_ENCRYPTION_KEY

const mockLog = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
} as unknown as FastifyBaseLogger

function setEncryptionKey(key: string): void {
    process.env.AP_ENCRYPTION_KEY = key
}

afterEach(() => {
    if (ORIGINAL_KEY !== undefined) {
        process.env.AP_ENCRYPTION_KEY = ORIGINAL_KEY
    }
})

describe('validateEnvPropsOnStartup — AP_ENCRYPTION_KEY shape', () => {
    it('accepts a 64-character hex key (openssl rand -hex 32)', async () => {
        setEncryptionKey(HEX_64_CHAR_KEY)

        await expect(validateEnvPropsOnStartup(mockLog)).resolves.toBeUndefined()
    })

    it('accepts the legacy 32-character key shape', async () => {
        setEncryptionKey(LEGACY_32_CHAR_KEY)

        await expect(validateEnvPropsOnStartup(mockLog)).resolves.toBeUndefined()
    })

    it('rejects a wrong-shape key with a descriptive operator message', async () => {
        setEncryptionKey('31-characters-of-garbage-no')

        await expect(validateEnvPropsOnStartup(mockLog)).rejects.toThrow(/AP_ENCRYPTION_KEY/)
    })
})
