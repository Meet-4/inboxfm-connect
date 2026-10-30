import { isNil } from '@inboxfm-connect/core-utils'
import { type ApLogger } from '@inboxfm-connect/server-utils'
import { ApEnvironment, ExecutionMode } from '@inboxfm-connect/shared'
import { createSandboxForJob } from './create-sandbox-for-job'
import { Sandbox } from './sandbox/types'
import { SandboxSettings } from './types'

export function createSandboxManager({ boxId, basePath, getSettings }: { boxId: number, basePath: string, getSettings: () => SandboxSettings }): SandboxManager {
    let currentSandbox: Sandbox | null = null

    return {
        async acquire(params: { log: ApLogger }): Promise<Sandbox> {
            if (canReuseSandbox(getSettings) && currentSandbox && currentSandbox.isReady()) {
                return currentSandbox
            }
            if (currentSandbox) {
                params.log.info('Sandbox not ready or not reusable, creating fresh one')
                // The replacement gets the SAME box-id, so the previous sandbox
                // must be fully torn down first: a fire-and-forget kill races
                // the new box's --cleanup/--init (isolate box lock held by the
                // dying process → spawn failures) and leaves the old ws server
                // holding the box's fixed port. Shutdown errors are logged,
                // not thrown — a dead box must never block the replacement.
                try {
                    await currentSandbox.shutdown()
                }
                catch (err) {
                    params.log.error({ error: err }, 'Error shutting down previous sandbox')
                }
            }
            currentSandbox = createSandboxForJob({ ...params, boxId, reusable: canReuseSandbox(getSettings), basePath, getSettings })
            return currentSandbox
        },
        async invalidate(log: ApLogger): Promise<void> {
            if (currentSandbox) {
                log.info('Invalidating sandbox')
                const sb = currentSandbox
                currentSandbox = null
                await sb.shutdown()
            }
        },
        async release(log: ApLogger): Promise<void> {
            if (!canReuseSandbox(getSettings)) {
                await this.invalidate(log)
            }
        },
        async shutdown(log: ApLogger): Promise<void> {
            await this.invalidate(log)
        },
        getActiveSandbox(): ActiveSandboxInfo | null {
            if (isNil(currentSandbox) || !currentSandbox.isReady()) {
                return null
            }
            const pid = currentSandbox.getPid()
            if (isNil(pid)) {
                return null
            }
            return {
                sandboxId: currentSandbox.id,
                boxId,
                pid,
                busy: currentSandbox.isBusy(),
            }
        },
    }
}

function canReuseSandbox(getSettings: () => SandboxSettings): boolean {
    const settings = getSettings()
    if (!isNil(settings.REUSE_SANDBOX)) {
        return settings.REUSE_SANDBOX === 'true'
    }
    if (settings.ENVIRONMENT === ApEnvironment.DEVELOPMENT) {
        return true
    }
    const trustedModes = [ExecutionMode.SANDBOX_CODE_ONLY, ExecutionMode.UNSANDBOXED]
    if (trustedModes.includes(settings.EXECUTION_MODE as ExecutionMode)) {
        return true
    }
    return false
}

export type ActiveSandboxInfo = {
    sandboxId: string
    boxId: number
    pid: number
    busy: boolean
}

export type SandboxManager = {
    acquire(params: { log: ApLogger }): Promise<Sandbox>
    invalidate(log: ApLogger): Promise<void>
    release(log: ApLogger): Promise<void>
    shutdown(log: ApLogger): Promise<void>
    getActiveSandbox(): ActiveSandboxInfo | null
}
