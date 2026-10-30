import { tryCatch } from '@inboxfm-connect/core-utils';
import { safeHttp } from './safe-http'

export const onCallService = (log: OnCallLogger, webhookUrl: string | undefined) => ({
    async page(error: OnCallPagePayload): Promise<void> {
        if (!webhookUrl) return
        const { data: response, error: fetchError } = await tryCatch(() =>
            safeHttp.axios.request({
                url: webhookUrl,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                data: { code: error.code, message: error.message, params: error.params },
                validateStatus: () => true,
            }),
        )
        if (fetchError) {
            log.error({ fetchError }, 'Failed to send on-call page')
            return
        }
        // validateStatus: () => true above means non-2xx responses resolve
        // instead of throwing — a page the endpoint rejected (wrong webhook
        // URL, pager outage) must not be treated as delivered, or the alert
        // this whole path exists for is silently lost.
        if (response && (response.status < 200 || response.status >= 300)) {
            log.error({ status: response.status, body: response.data }, 'Failed to send on-call page')
        }
    },
})

type OnCallLogger = {
    error: (obj: Record<string, unknown>, msg: string) => void
}

export type OnCallPagePayload = {
    code: string
    message: string
    params?: Record<string, unknown>
}
