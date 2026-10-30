import { ApEnvironment, ExecutionMode, NetworkMode } from '@inboxfm-connect/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/lib/create-sandbox-for-job', () => ({
    createSandboxForJob: vi.fn().mockReturnValue({
        isReady: () => true,
        shutdown: vi.fn().mockResolvedValue(undefined),
    }),
}))

import { createSandboxManager } from '../../../src/lib/sandbox-manager'

const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnValue({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }),
} as never

function buildSettings({ executionMode, environment }: { executionMode: string, environment: string }) {
    return {
        PUBLIC_URL: 'http://localhost:3000',
        TRIGGER_TIMEOUT_SECONDS: 60,
        PAUSED_FLOW_TIMEOUT_DAYS: 30,
        EXECUTION_MODE: executionMode,
        FLOW_TIMEOUT_SECONDS: 600,
        LOG_LEVEL: 'info',
        LOG_PRETTY: 'false',
        ENVIRONMENT: environment,
        APP_WEBHOOK_SECRETS: '{}',
        MAX_FLOW_RUN_LOG_SIZE_MB: 10,
        MAX_FILE_SIZE_MB: 10,
        SANDBOX_MEMORY_LIMIT: '1024',
        SANDBOX_PROPAGATED_ENV_VARS: [] as string[],
        DEV_PIECES: [] as string[],
        OTEL_ENABLED: false,
        FILE_STORAGE_LOCATION: '/tmp',
        S3_USE_SIGNED_URLS: 'false',
        EDITION: 'community',
        NETWORK_MODE: NetworkMode.UNRESTRICTED,
        SSRF_ALLOW_LIST: [] as string[],
        REUSE_SANDBOX: undefined as string | undefined,
    }
}

describe('sandbox-manager canReuseSandbox', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('SANDBOX_PROCESS mode → sandbox NOT reusable (release invalidates)', async () => {
        const settings = buildSettings({
            executionMode: ExecutionMode.SANDBOX_PROCESS,
            environment: ApEnvironment.PRODUCTION,
        })

        const manager = createSandboxManager({ boxId: 1, basePath: '/tmp', getSettings: () => settings })
        await manager.acquire({ log })
        await manager.release(log)

        const { createSandboxForJob } = await import('../../../src/lib/create-sandbox-for-job')
        expect(createSandboxForJob).toHaveBeenCalledTimes(1)

        await manager.acquire({ log })
        expect(createSandboxForJob).toHaveBeenCalledTimes(2)
    })

    it('SANDBOX_CODE_AND_PROCESS mode → sandbox NOT reusable (release invalidates)', async () => {
        const settings = buildSettings({
            executionMode: ExecutionMode.SANDBOX_CODE_AND_PROCESS,
            environment: ApEnvironment.PRODUCTION,
        })

        const manager = createSandboxManager({ boxId: 1, basePath: '/tmp', getSettings: () => settings })
        manager.acquire({ log })
        await manager.release(log)

        const { createSandboxForJob } = await import('../../../src/lib/create-sandbox-for-job')
        await manager.acquire({ log })
        expect(createSandboxForJob).toHaveBeenCalledTimes(2)
    })

    it('SANDBOX_CODE_ONLY mode → sandbox reusable (release does NOT invalidate)', async () => {
        const settings = buildSettings({
            executionMode: ExecutionMode.SANDBOX_CODE_ONLY,
            environment: ApEnvironment.PRODUCTION,
        })

        const manager = createSandboxManager({ boxId: 1, basePath: '/tmp', getSettings: () => settings })
        manager.acquire({ log })
        await manager.release(log)

        const { createSandboxForJob } = await import('../../../src/lib/create-sandbox-for-job')
        await manager.acquire({ log })
        expect(createSandboxForJob).toHaveBeenCalledTimes(1)
    })

    it('UNSANDBOXED mode → sandbox reusable (release does NOT invalidate)', async () => {
        const settings = buildSettings({
            executionMode: ExecutionMode.UNSANDBOXED,
            environment: ApEnvironment.PRODUCTION,
        })

        const manager = createSandboxManager({ boxId: 1, basePath: '/tmp', getSettings: () => settings })
        await manager.acquire({ log })
        await manager.release(log)

        const { createSandboxForJob } = await import('../../../src/lib/create-sandbox-for-job')
        await manager.acquire({ log })
        expect(createSandboxForJob).toHaveBeenCalledTimes(1)
    })

    it('DEVELOPMENT environment → sandbox reusable regardless of execution mode', async () => {
        const settings = buildSettings({
            executionMode: ExecutionMode.SANDBOX_PROCESS,
            environment: ApEnvironment.DEVELOPMENT,
        })

        const manager = createSandboxManager({ boxId: 1, basePath: '/tmp', getSettings: () => settings })
        await manager.acquire({ log })
        await manager.release(log)

        const { createSandboxForJob } = await import('../../../src/lib/create-sandbox-for-job')
        await manager.acquire({ log })
        expect(createSandboxForJob).toHaveBeenCalledTimes(1)
    })
})

describe('sandbox-manager acquire replacement', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('awaits the previous sandbox shutdown before creating a replacement (no kill-race on the same box)', async () => {
        const settings = buildSettings({
            executionMode: ExecutionMode.SANDBOX_PROCESS,
            environment: ApEnvironment.PRODUCTION,
        })

        const events: string[] = []
        let releaseShutdown: (() => void) | null = null
        const slowShutdown = new Promise<void>((resolve) => {
            releaseShutdown = resolve
        })

        const { createSandboxForJob } = await import('../../../src/lib/create-sandbox-for-job')
        vi.mocked(createSandboxForJob)
            // First sandbox: not ready anymore (e.g. crashed between runs).
            .mockImplementationOnce(() => ({
                isReady: () => false,
                shutdown: vi.fn(() => {
                    events.push('shutdown-start')
                    return slowShutdown.then(() => events.push('shutdown-end'))
                }),
            }) as never)
            // Replacement sandbox: record the exact moment it is created.
            .mockImplementationOnce(() => {
                events.push('sandbox-created')
                return {
                    isReady: () => true,
                    shutdown: vi.fn().mockResolvedValue(undefined),
                } as never
            })

        const manager = createSandboxManager({ boxId: 1, basePath: '/tmp', getSettings: () => settings })
        await manager.acquire({ log })

        // Second acquire sees the dead sandbox and must replace it — but only
        // after the old one (same isolate box-id!) has fully shut down.
        const secondAcquire = manager.acquire({ log })
        await new Promise((resolve) => setImmediate(resolve))

        // Let the in-flight shutdown complete, then collect the acquire.
        releaseShutdown!()
        await secondAcquire

        // The replacement may only be created once the previous sandbox's
        // process tree is confirmed dead: both share one isolate box-id, so a
        // replacement racing the kill re-inits/cleans the box underneath a
        // still-running old process (box lock contention → transient run
        // failures) and re-binds the box's fixed ws port under the old server.
        expect(events).toEqual(['shutdown-start', 'shutdown-end', 'sandbox-created'])
    })
})
