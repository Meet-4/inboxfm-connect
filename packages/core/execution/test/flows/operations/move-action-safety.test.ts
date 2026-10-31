import { describe, expect, it } from 'vitest'
import { ActivepiecesError, ErrorCode } from '@inboxfm-connect/core-utils'
import {
    CodeAction,
    FlowAction,
    FlowActionType,
    LoopOnItemsAction,
} from '../../../src/lib/flows/actions/action'
import { FlowVersion, FlowVersionState } from '../../../src/lib/flows/flow-version'
import { flowOperations, FlowOperationType, StepLocationRelativeToParent } from '../../../src/lib/flows/operations'
import { _moveAction } from '../../../src/lib/flows/operations/move-action'
import { EmptyTrigger, FlowTriggerType } from '../../../src/lib/flows/triggers/trigger'
import { flowStructureUtil } from '../../../src/lib/flows/util/flow-structure-util'

const createMockEmptyTrigger = (name = 'trigger', nextAction?: FlowAction): EmptyTrigger => ({
    name,
    valid: true,
    displayName: 'Empty Trigger',
    type: FlowTriggerType.EMPTY,
    settings: {},
    lastUpdatedDate: '2026-01-01T00:00:00.000Z',
    nextAction,
})

const createMockCodeAction = (name: string, nextAction?: FlowAction): CodeAction => ({
    name,
    valid: true,
    displayName: `Action ${name}`,
    type: FlowActionType.CODE,
    settings: {
        sourceCode: { code: '', packageJson: '{}' },
        input: {},
    },
    lastUpdatedDate: '2026-01-01T00:00:00.000Z',
    nextAction,
})

const createMockLoopAction = (name: string, firstLoopAction?: FlowAction, nextAction?: FlowAction): LoopOnItemsAction => ({
    name,
    valid: true,
    displayName: `Loop ${name}`,
    type: FlowActionType.LOOP_ON_ITEMS,
    settings: {
        items: '{{trigger.output.body}}',
    },
    lastUpdatedDate: '2026-01-01T00:00:00.000Z',
    nextAction,
    firstLoopAction,
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

const expectInvalidOperationError = (error: unknown) => {
    expect(error).toBeInstanceOf(ActivepiecesError)
    expect((error as ActivepiecesError).error.code).toBe(ErrorCode.FLOW_OPERATION_INVALID)
}

describe('move-step safety', () => {
    it('rejects moving a loop after a step inside its own body instead of silently deleting the loop and body', () => {
        const bodyStep = createMockCodeAction('step_2')
        const afterStep = createMockCodeAction('step_3')
        const loop = createMockLoopAction('loop_1', bodyStep, afterStep)
        const flow = createMockFlowVersion(createMockEmptyTrigger('trigger', loop))

        // Before the guard this applied as DELETE + no-op ADD: the loop and its body
        // vanished while the version stayed valid.
        expect(() => _moveAction(flow, {
            name: 'loop_1',
            newParentStep: 'step_2',
            stepLocationRelativeToNewParent: StepLocationRelativeToParent.AFTER,
        })).toThrow(ActivepiecesError)

        try {
            _moveAction(flow, {
                name: 'loop_1',
                newParentStep: 'step_2',
                stepLocationRelativeToNewParent: StepLocationRelativeToParent.AFTER,
            })
        }
        catch (error) {
            expectInvalidOperationError(error)
        }
    })

    it('rejects moving a step after itself', () => {
        const step1 = createMockCodeAction('step_1')
        const flow = createMockFlowVersion(createMockEmptyTrigger('trigger', step1))

        try {
            _moveAction(flow, {
                name: 'step_1',
                newParentStep: 'step_1',
                stepLocationRelativeToNewParent: StepLocationRelativeToParent.AFTER,
            })
            expect.fail('expected FLOW_OPERATION_INVALID')
        }
        catch (error) {
            expectInvalidOperationError(error)
        }
    })

    it('flowOperations.apply(MOVE_ACTION) preserves the flow when the move targets the moved step itself', () => {
        const step1 = createMockCodeAction('step_1')
        const flow = createMockFlowVersion(createMockEmptyTrigger('trigger', step1))

        expect(() => flowOperations.apply(flow, {
            type: FlowOperationType.MOVE_ACTION,
            request: {
                name: 'step_1',
                newParentStep: 'step_1',
                stepLocationRelativeToNewParent: StepLocationRelativeToParent.AFTER,
            },
        })).toThrow(ActivepiecesError)

        // The input version is untouched by the rejected operation.
        const names = flowStructureUtil.getAllSteps(flow.trigger).map((step) => step.name)
        expect(names).toEqual(['trigger', 'step_1'])
    })

    it('flowOperations.apply(MOVE_ACTION) preserves loop and body when the move targets the body', () => {
        const bodyStep = createMockCodeAction('step_2')
        const afterStep = createMockCodeAction('step_3')
        const loop = createMockLoopAction('loop_1', bodyStep, afterStep)
        const flow = createMockFlowVersion(createMockEmptyTrigger('trigger', loop))

        expect(() => flowOperations.apply(flow, {
            type: FlowOperationType.MOVE_ACTION,
            request: {
                name: 'loop_1',
                newParentStep: 'step_2',
                stepLocationRelativeToNewParent: StepLocationRelativeToParent.AFTER,
            },
        })).toThrow(ActivepiecesError)
    })

    it('still allows moving a loop after an unrelated step', () => {
        const bodyStep = createMockCodeAction('step_2')
        const afterStep = createMockCodeAction('step_3')
        const loop = createMockLoopAction('loop_1', bodyStep, afterStep)
        const flow = createMockFlowVersion(createMockEmptyTrigger('trigger', loop))

        const result = flowOperations.apply(flow, {
            type: FlowOperationType.MOVE_ACTION,
            request: {
                name: 'loop_1',
                newParentStep: 'step_3',
                stepLocationRelativeToNewParent: StepLocationRelativeToParent.AFTER,
            },
        })

        const names = flowStructureUtil.getAllSteps(result.trigger).map((step) => step.name)
        expect(names.sort()).toEqual(['loop_1', 'step_2', 'step_3', 'trigger'])
    })

    it('ADD_ACTION throws ENTITY_NOT_FOUND when the parent step does not exist', () => {
        const flow = createMockFlowVersion(createMockEmptyTrigger('trigger'))

        try {
            flowOperations.apply(flow, {
                type: FlowOperationType.ADD_ACTION,
                request: {
                    parentStep: 'no_such_step',
                    stepLocationRelativeToParent: StepLocationRelativeToParent.AFTER,
                    action: createMockCodeAction('step_1'),
                },
            })
            expect.fail('expected ENTITY_NOT_FOUND')
        }
        catch (error) {
            expect(error).toBeInstanceOf(ActivepiecesError)
            expect((error as ActivepiecesError).error.code).toBe(ErrorCode.ENTITY_NOT_FOUND)
        }
    })
})
