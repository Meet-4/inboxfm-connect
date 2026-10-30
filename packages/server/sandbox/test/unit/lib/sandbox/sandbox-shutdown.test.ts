import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createSandbox } from '../../../../src/lib/sandbox/sandbox'
import { SandboxLogger } from '../../../../src/lib/sandbox/types'

const log: SandboxLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
}

// A child whose spawn failed: no pid, but 'error'/'close' still fire — the exact
// shape Node gives when the engine binary cannot be forked/exec'd.
function makePidLessChild(): EventEmitter {
    const child = new EventEmitter()
    Object.defineProperty(child, 'pid', { value: undefined })
    return child
}

function makeProcessMaker(child: EventEmitter) {
    return {
        create: async () => child as never,
    }
}

function buildInitOptions() {
    return {
        env: {},
        memoryLimitMb: 256,
        timeLimitSeconds: 60,
        reusable: false,
        maxHttpBufferSizeBytes: 1024,
        basePath: '/tmp',
        wsRpcPort: 0,
    }
}

async function startFailedSandbox(child: EventEmitter): Promise<ReturnType<typeof createSandbox>> {
    const sandbox = createSandbox(log, 'sb-shutdown-test', buildInitOptions(), makeProcessMaker(child))
    const startPromise = sandbox.start({ flowVersionId: 'fv1', platformId: 'p1', mounts: [] })
    // Let start() reach the exit-watch registration, then crash the child.
    await new Promise((resolve) => setImmediate(resolve))
    child.emit('close', 1, null)
    await expect(startPromise).rejects.toThrow(/exited before connecting/)
    return sandbox
}

describe('createSandbox.shutdown error-path teardown', () => {
    it('still tears down the socket server when the child never got a pid (spawn failure)', async () => {
        const child = makePidLessChild()
        const sandbox = await startFailedSandbox(child)

        // The sandbox holds a live (bound) socket.io server from start()'s
        // createSocketServer. shutdown must never abandon that teardown: a
        // killProcess throw for a pid-less child used to escape before
        // io.close(), permanently leaking the box's bound ws port.
        await expect(sandbox.shutdown()).resolves.toBeUndefined()

        // Idempotent: a second shutdown (e.g. invalidate + runtime shutdown) is a no-op.
        await expect(sandbox.shutdown()).resolves.toBeUndefined()
        expect(log.error).not.toHaveBeenCalledWith(expect.objectContaining({}), 'No PID found for child process')
    })

    it('logs the kill failure but completes teardown when treeKill reports a dead pid', async () => {
        const child = makePidLessChild()
        const sandbox = await startFailedSandbox(child)

        await expect(sandbox.shutdown()).resolves.toBeUndefined()

        // The sandbox is not usable afterwards.
        expect(sandbox.isReady()).toBe(false)
        expect(sandbox.getPid()).toBeNull()
    })
})
