import { describe, expect, it } from 'vitest'
import { ActivepiecesError, ErrorCode } from '@inboxfm-connect/core-utils'
import { BranchExecutionType, FlowAction, FlowActionType, RouterAction } from '../../../src/lib/flows/actions/action'
import { FlowVersion, FlowVersionState } from '../../../src/lib/flows/flow-version'
import { flowOperations, FlowOperationType, StepLocationRelativeToParent } from '../../../src/lib/flows/operations'
import { EmptyTrigger, FlowTriggerType } from '../../../src/lib/flows/triggers/trigger'

const createMockEmptyTrigger = (name = 'trigger', nextAction?: FlowAction): EmptyTrigger => ({
    name,
    valid: true,
    displayName: 'Empty Trigger',
    type: FlowTriggerType.EMPTY,
    settings: {},
    lastUpdatedDate: '2026-01-01T00:00:00.000Z',
    nextAction,
})

const createMockCodeAction = (name: string, nextAction?: FlowAction): FlowAction => ({
    name,
    valid: true,
    displayName: `Action ${name}`,
    type: FlowActionType.CODE,
    settings: {
        sourceCode: { code: '', packageJson: '{}' },
        input: {},
    } as never,
    lastUpdatedDate: '2026-01-01T00:00:00.000Z',
    nextAction,
})

const createMockRouterAction = (name: string, branches: number): RouterAction => ({
    name,
    valid: true,
    displayName: `Router ${name}`,
    type: FlowActionType.ROUTER,
    settings: {
        branches: Array.from({ length: branches }, (_, index) => index === branches - 1
            ? { branchName: `branch_${index}`, branchType: BranchExecutionType.FALLBACK }
            : {
                branchName: `branch_${index}`,
                branchType: BranchExecutionType.CONDITION,
                conditions: [[{ firstValue: 'x', operator: 'TEXT_CONTAINS' as const }]],
            }),
        executionType: 'EXECUTE_FIRST_MATCH' as never,
    } as never,
    children: Array.from({ length: branches }, () => null),
    lastUpdatedDate: '2026-01-01T00:00:00.000Z',
})

const createMockFlowVersion = (trigger: EmptyTrigger): FlowVersion => ({
    id: 'v1',
    flowId: 'f1',
    displayName: 'Test Flow',
    trigger,
    valid: true,
    state: FlowVersionState.DRAFT,
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    notes: [],
})

describe('router branchIndex bounds on add', () => {
    it('rejects INSIDE_BRANCH with a branchIndex beyond the router branches', () => {
        const router = createMockRouterAction('router_1', 2)
        const flow = createMockFlowVersion(createMockEmptyTrigger('trigger', router))

        try {
            flowOperations.apply(flow, {
                type: FlowOperationType.ADD_ACTION,
                request: {
                    parentStep: 'router_1',
                    stepLocationRelativeToParent: StepLocationRelativeToParent.INSIDE_BRANCH,
                    branchIndex: 5,
                    action: createMockCodeAction('in_branch'),
                },
            })
            expect.fail('expected FLOW_OPERATION_INVALID')
        }
        catch (error) {
            expect(error).toBeInstanceOf(ActivepiecesError)
            expect((error as ActivepiecesError).error.code).toBe(ErrorCode.FLOW_OPERATION_INVALID)
        }

        // The router was not mutated into a desynced state by the rejected operation.
        expect(router.children).toHaveLength(2)
        expect(router.children.every((child) => child === null)).toBe(true)
    })

    it('rejects INSIDE_BRANCH with a negative branchIndex', () => {
        const router = createMockRouterAction('router_1', 2)
        const flow = createMockFlowVersion(createMockEmptyTrigger('trigger', router))

        expect(() => flowOperations.apply(flow, {
            type: FlowOperationType.ADD_ACTION,
            request: {
                parentStep: 'router_1',
                stepLocationRelativeToParent: StepLocationRelativeToParent.INSIDE_BRANCH,
                branchIndex: -1,
                action: createMockCodeAction('in_branch'),
            },
        })).toThrow(ActivepiecesError)
    })

    it('still adds a step inside a valid branch and keeps children aligned with branches', () => {
        const router = createMockRouterAction('router_1', 2)
        const flow = createMockFlowVersion(createMockEmptyTrigger('trigger', router))

        const result = flowOperations.apply(flow, {
            type: FlowOperationType.ADD_ACTION,
            request: {
                parentStep: 'router_1',
                stepLocationRelativeToParent: StepLocationRelativeToParent.INSIDE_BRANCH,
                branchIndex: 1,
                action: createMockCodeAction('in_branch'),
            },
        })

        const updatedRouter = result.trigger.nextAction as RouterAction
        expect(updatedRouter.children).toHaveLength(2)
        expect(updatedRouter.children[1]?.name).toBe('in_branch')
        expect(updatedRouter.settings.branches).toHaveLength(2)
    })
})
