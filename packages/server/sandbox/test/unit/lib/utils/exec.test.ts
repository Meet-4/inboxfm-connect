import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockTreeKill = vi.fn((pid: number, signal: string, callback?: (err?: Error) => void) => {
    callback?.()
})

vi.mock('tree-kill', () => ({
    default: mockTreeKill,
}))

beforeEach(() => {
    vi.clearAllMocks()
})

const { spawnWithKill } = await import('../../../../src/lib/utils/exec')

describe('spawnWithKill tree-kill usage (unit)', () => {
    it('does not tree-kill the already-exited pid on a clean exit', async () => {
        const result = await spawnWithKill({
            cmd: process.execPath,
            args: ['-e', 'console.log("clean-exit")'],
        })

        expect(result.stdout).toContain('clean-exit')
        expect(mockTreeKill).not.toHaveBeenCalled()
    })

    it('does not tree-kill the already-exited pid when the command fails', async () => {
        await expect(spawnWithKill({
            cmd: process.execPath,
            args: ['-e', 'process.exit(3)'],
        })).rejects.toThrow('Exit 3')

        expect(mockTreeKill).not.toHaveBeenCalled()
    })

    it('does not tree-kill when the process could not be spawned at all', async () => {
        await expect(spawnWithKill({
            cmd: 'definitely-not-a-command-xyz',
            args: ['--foo'],
        })).rejects.toThrow()

        expect(mockTreeKill).not.toHaveBeenCalled()
    })

    it('tree-kills the still-running process tree only on timeout', async () => {
        await expect(spawnWithKill({
            cmd: process.execPath,
            // the child outlives the timeout and exits on its own afterwards,
            // so the mocked tree-kill leaves no orphan behind
            args: ['-e', 'setTimeout(() => process.exit(0), 800)'],
            timeoutMs: 100,
        })).rejects.toThrow('Timeout after 100ms')

        expect(mockTreeKill).toHaveBeenCalledOnce()
        expect(mockTreeKill.mock.calls[0]?.[0]).toBeGreaterThan(0)
        expect(mockTreeKill.mock.calls[0]?.[1]).toBe('SIGKILL')
    })
})
