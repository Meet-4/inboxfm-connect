import {
    createPiece,
    createTrigger,
    IntegrationAuthProperty,
    PieceAuth,
    Property,
    TriggerStrategy,
} from '@inboxfm-connect/pieces-framework'
import { EngineGenericError, FlowVersionState, StreamStepProgress, TriggerHookType } from '@inboxfm-connect/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineConstants } from '../../src/lib/handler/context/engine-constants'
import { pieceLoader } from '../../src/lib/helper/piece-loader'
import { triggerHelper } from '../../src/lib/helper/trigger-helper'

const seen: Record<string, unknown>[] = []

const pollingTrigger = createTrigger({
    name: 'new_item',
    displayName: 'New Item',
    description: 'Polls for new items',
    requireAuth: false,
    props: {
        channel: Property.ShortText({ displayName: 'Channel', required: true }),
    },
    type: TriggerStrategy.POLLING,
    sampleData: { id: 'sample' },
    async onEnable(context) {
        seen.push({ hook: 'onEnable', propsValue: context.propsValue })
        context.setSchedule({ cronExpression: '*/5 * * * *', timezone: 'Asia/Kolkata' })
    },
    async onDisable(context) {
        seen.push({ hook: 'onDisable', propsValue: context.propsValue })
    },
    async run(context) {
        seen.push({ hook: 'run', propsValue: context.propsValue })
        return [{ id: 1 }]
    },
    async test(context) {
        await context.store.put('cursor', 1)
        return [{ id: 'test-sample' }]
    },
})

const appWebhookTrigger = createTrigger({
    name: 'app_event',
    displayName: 'App Event',
    description: 'Receives app webhooks',
    requireAuth: false,
    props: {},
    type: TriggerStrategy.APP_WEBHOOK,
    sampleData: {},
    async onEnable(context) {
        context.app.createListeners({ events: ['message.created'], identifierValue: 'account-1' })
    },
    async onDisable() {
        seen.push({ hook: 'app-onDisable' })
    },
    async run() {
        return []
    },
})

const piece = createPiece<IntegrationAuthProperty>({
    displayName: 'Stub',
    logoUrl: 'https://example.com/logo.png',
    description: 'Stub piece',
    authors: [],
    auth: PieceAuth.None(),
    actions: [],
    triggers: [pollingTrigger, appWebhookTrigger],
})

const flowVersion = {
    id: 'fv-1',
    flowId: 'flow-1',
    state: FlowVersionState.LOCKED,
    trigger: {
        name: 'trigger_1',
        type: 'PIECE_TRIGGER',
        settings: {
            pieceName: 'stub-piece',
            pieceVersion: '0.0.1',
            triggerName: 'new_item',
            input: { channel: 'general' },
            propertySettings: {},
        },
    },
}

function makeConstants(): EngineConstants {
    return new EngineConstants({
        flowId: 'flow-1',
        flowVersionId: 'fv-1',
        flowVersionState: FlowVersionState.LOCKED,
        triggerPieceName: 'stub-piece',
        flowRunId: 'run-1',
        publicApiUrl: 'http://localhost:4200/api/',
        internalApiUrl: 'http://localhost:3000/api/',
        retryConstants: { maxAttempts: 1, retryExponential: 1, retryInterval: 1 },
        engineToken: 'engine-token',
        projectId: 'project-1',
        streamStepProgress: StreamStepProgress.NONE,
        workerHandlerId: null,
        httpRequestId: null,
        timeoutInSeconds: 60,
        platformId: 'platform-1',
        stepNames: ['trigger_1'],
    })
}

function makeParams(hookType: TriggerHookType, overrides: Record<string, unknown> = {}) {
    return {
        hookType,
        test: false,
        flowVersion,
        webhookUrl: 'http://localhost:4200/api/v1/webhooks/flow-1',
        triggerPayload: { body: { message: 'hello' }, headers: {}, queryParams: {} },
        projectId: 'project-1',
        platformId: 'platform-1',
        engineToken: 'engine-token',
        internalApiUrl: 'http://localhost:3000/api/',
        publicApiUrl: 'http://localhost:4200/api/',
        timeoutInSeconds: 60,
        ...overrides,
    } as never
}

describe('triggerHelper.executeTrigger', () => {
    beforeEach(() => {
        seen.length = 0
        vi.restoreAllMocks()
        vi.spyOn(pieceLoader, 'getPieceAndTriggerOrThrow').mockImplementation((async ({ triggerName }: { triggerName: string }) => {
            const pieceTrigger = piece.getTrigger(triggerName)
            if (!pieceTrigger) {
                throw new Error(`missing trigger ${triggerName}`)
            }
            return { piece, pieceTrigger }
        }) as never)
    })

    it('returns the cron a polling trigger registers in onEnable', async () => {
        const response = await triggerHelper.executeTrigger({
            params: makeParams(TriggerHookType.ON_ENABLE),
            constants: makeConstants(),
        })

        expect(response).toEqual({
            listeners: [],
            scheduleOptions: {
                type: 'CRON_EXPRESSION',
                cronExpression: '*/5 * * * *',
                timezone: 'Asia/Kolkata',
            },
        })
        expect(seen).toEqual([{ hook: 'onEnable', propsValue: { channel: 'general' } }])
    })

    it('returns the listeners an app-webhook trigger registers in onEnable', async () => {
        const params = makeParams(TriggerHookType.ON_ENABLE, {
            flowVersion: {
                ...flowVersion,
                trigger: {
                    ...flowVersion.trigger,
                    settings: { ...flowVersion.trigger.settings, triggerName: 'app_event' },
                },
            },
        })

        const response = await triggerHelper.executeTrigger({ params, constants: makeConstants() })

        expect(response).toEqual({
            listeners: [{ events: ['message.created'], identifierValue: 'account-1' }],
        })
    })

    it('returns the items a polling trigger produces on RUN', async () => {
        const response = await triggerHelper.executeTrigger({
            params: makeParams(TriggerHookType.RUN),
            constants: makeConstants(),
        })

        expect(response).toEqual({ output: [{ id: 1 }] })
        expect(seen).toEqual([{ hook: 'run', propsValue: { channel: 'general' } }])
    })

    it('scopes store access of a test run to the test namespace', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ key: 'k', value: 1 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }))
        vi.stubGlobal('fetch', fetchMock)

        try {
            const response = await triggerHelper.executeTrigger({
                params: makeParams(TriggerHookType.TEST, { test: true }),
                constants: makeConstants(),
            })

            expect(response).toEqual({ output: [{ id: 'test-sample' }] })
            const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
            const postedBody = JSON.parse(requestInit.body as string)
            expect(postedBody.key).toBe('testflow_flow-1/cursor')
        }
        finally {
            vi.unstubAllGlobals()
        }
    })

    it('rejects an unknown hook type instead of reporting a successful no-op', async () => {
        await expect(triggerHelper.executeTrigger({
            params: makeParams('RENEW_ALL' as unknown as TriggerHookType),
            constants: makeConstants(),
        })).rejects.toThrow(EngineGenericError)
    })
})

