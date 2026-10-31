import { describe, expect, it } from 'vitest'
import { ActivepiecesError, ErrorCode } from '@inboxfm-connect/core-utils'
import {
    BranchExecutionType,
    CodeAction,
    FlowAction,
    FlowActionType,
    RouterAction,
} from '../../../src/lib/flows/actions/action'
import { FlowVersion, FlowVersionState } from '../../../src/lib/flows/flow-version'
import { flowOperations, FlowOperationType, StepLocationRelativeToParent } from '../../../src/lib/flows/operations'
import { _importFlow } from '../../../src/lib/flows/operations/import-flow'
import { _updateTrigger } from '../../../src/lib/flows/operations/update-trigger'
import { EmptyTrigger, FlowTrigger, FlowTriggerType, PieceTrigger } from '../../../src/lib/flows/triggers/trigger'
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

const createMockFlowVersion = (trigger: FlowTrigger): FlowVersion => ({
    id: 'v1',
    flowId: 'f1',
    displayName: 'Test Flow',
    trigger,
    valid: true,
    state: FlowVersionState.DRAFT,
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    updatedBy: null,
    schemaVersion: null,
    agentIds: [],
    connectionIds: [],
    backupFiles: null,
    notes: [],
} as FlowVersion)

const expectInvalidOperationError = (error: unknown) => {
    expect(error).toBeInstanceOf(ActivepiecesError)
    expect((error as ActivepiecesError).error.code).toBe(ErrorCode.FLOW_OPERATION_INVALID)
}

describe('step-name uniqueness', () => {
    it('rejects ADD_ACTION with a step name that already exists in the flow', () => {
        const step1 = createMockCodeAction('step_1')
        const flow = createMockFlowVersion(createMockEmptyTrigger('trigger', step1))

        try {
            flowOperations.apply(flow, {
                type: FlowOperationType.ADD_ACTION,
                request: {
                    parentStep: 'trigger',
                    stepLocationRelativeToParent: StepLocationRelativeToParent.AFTER,
                    action: createMockCodeAction('step_1'),
                },
            })
            expect.fail('expected FLOW_OPERATION_INVALID')
        }
        catch (error) {
            expectInvalidOperationError(error)
        }

        expect(flowStructureUtil.getAllSteps(flow.trigger).map((s) => s.name)).toEqual(['trigger', 'step_1'])
    })

    it('rejects ADD_ACTION with the reserved trigger name instead of infinitely recursing', () => {
        const flow = createMockFlowVersion(createMockEmptyTrigger('trigger'))

        // Before the uniqueness guard this created a step named like its own parent
        // and the name-matching transfer recursed on every created step until the
        // call stack overflowed.
        try {
            flowOperations.apply(flow, {
                type: FlowOperationType.ADD_ACTION,
                request: {
                    parentStep: 'trigger',
                    stepLocationRelativeToParent: StepLocationRelativeToParent.AFTER,
                    action: createMockCodeAction('trigger'),
                },
            })
            expect.fail('expected FLOW_OPERATION_INVALID')
        }
        catch (error) {
            expectInvalidOperationError(error)
        }
    })

    it('still adds a step with a fresh name', () => {
        const step1 = createMockCodeAction('step_1')
        const flow = createMockFlowVersion(createMockEmptyTrigger('trigger', step1))

        const result = flowOperations.apply(flow, {
            type: FlowOperationType.ADD_ACTION,
            request: {
                parentStep: 'trigger',
                stepLocationRelativeToParent: StepLocationRelativeToParent.AFTER,
                action: createMockCodeAction('step_2'),
            },
        })

        expect(flowStructureUtil.getAllSteps(result.trigger).map((s) => s.name)).toEqual(['trigger', 'step_2', 'step_1'])
    })

    it('rejects importing a flow whose tree contains duplicate step names', () => {
        const flow = createMockFlowVersion(createMockEmptyTrigger('trigger', createMockCodeAction('step_1')))

        const importedTrigger: FlowTrigger = {
            ...createMockEmptyTrigger('trigger', createMockCodeAction('dup', createMockCodeAction('dup'))),
        }

        try {
            _importFlow(flow, {
                displayName: 'Imported Flow',
                trigger: importedTrigger,
                schemaVersion: null,
                notes: null,
            })
            expect.fail('expected FLOW_OPERATION_INVALID')
        }
        catch (error) {
            expectInvalidOperationError(error)
        }
    })

    it('rejects importing a flow where an action reuses the trigger name', () => {
        const flow = createMockFlowVersion(createMockEmptyTrigger('trigger'))

        const importedTrigger: FlowTrigger = {
            ...createMockEmptyTrigger('trigger', createMockCodeAction('trigger')),
        }

        try {
            _importFlow(flow, {
                displayName: 'Imported Flow',
                trigger: importedTrigger,
                schemaVersion: null,
                notes: null,
            })
            expect.fail('expected FLOW_OPERATION_INVALID')
        }
        catch (error) {
            expectInvalidOperationError(error)
        }
    })

    it('still imports a flow with unique step names', () => {
        const flow = createMockFlowVersion(createMockEmptyTrigger('trigger', createMockCodeAction('old_step')))

        const importedTrigger: FlowTrigger = {
            ...createMockEmptyTrigger('trigger', createMockCodeAction('step_a', createMockCodeAction('step_b'))),
        }

        const ops = _importFlow(flow, {
            displayName: 'Imported Flow',
            trigger: importedTrigger,
            schemaVersion: null,
            notes: null,
        })

        let updated = flow
        for (const op of ops) {
            updated = flowOperations.apply(updated, op)
        }

        expect(flowStructureUtil.getAllSteps(updated.trigger).map((s) => s.name)).toEqual(['trigger', 'step_a', 'step_b'])
        expect(updated.displayName).toBe('Imported Flow')
    })
})

describe('update-trigger targets only the root trigger', () => {
    it('rejects UPDATE_TRIGGER whose name addresses an action instead of the trigger', () => {
        const step1 = createMockCodeAction('step_1')
        const flow = createMockFlowVersion(createMockEmptyTrigger('trigger', step1))

        // Before the guard this replaced the action named "step_1" with a trigger
        // object in the middle of the tree while the version stayed valid.
        try {
            _updateTrigger(flow, {
                name: 'step_1',
                displayName: 'Sneaky Trigger',
                type: FlowTriggerType.EMPTY,
                settings: {},
                valid: true,
            })
            expect.fail('expected FLOW_OPERATION_INVALID')
        }
        catch (error) {
            expectInvalidOperationError(error)
        }

        expect(flowStructureUtil.getAllSteps(flow.trigger).map((s) => s.name)).toEqual(['trigger', 'step_1'])
        expect((flow.trigger.nextAction as FlowAction).type).toBe(FlowActionType.CODE)
    })

    it('still updates the root trigger by its name', () => {
        const step1 = createMockCodeAction('step_1')
        const flow = createMockFlowVersion(createMockEmptyTrigger('trigger', step1))

        const updated = _updateTrigger(flow, {
            name: 'trigger',
            displayName: 'Renamed Trigger',
            type: FlowTriggerType.EMPTY,
            settings: {},
            valid: true,
        })

        expect(updated.trigger.displayName).toBe('Renamed Trigger')
        expect(updated.trigger.nextAction?.name).toBe('step_1')
    })

    it('replaces only the root trigger even if a legacy action shares its name', () => {
        // Simulate a legacy version that already contains an action named like the
        // trigger (possible before uniqueness was enforced at the add/import gates).
        const duplicateAction = createMockCodeAction('trigger')
        const flow = createMockFlowVersion(createMockEmptyTrigger('trigger', duplicateAction))

        const updated = _updateTrigger(flow, {
            name: 'trigger',
            displayName: 'Renamed Trigger',
            type: FlowTriggerType.EMPTY,
            settings: {},
            valid: true,
        })

        expect(updated.trigger.displayName).toBe('Renamed Trigger')
        const nextAction = updated.trigger.nextAction as FlowAction
        // The mid-tree action was not converted into a trigger.
        expect(nextAction.type).toBe(FlowActionType.CODE)
        expect(nextAction.displayName).toBe('Action trigger')
    })

    it('preserves piece trigger sampleData when updating the root trigger', () => {
        const pieceTrigger: PieceTrigger = {
            name: 'trigger',
            valid: true,
            displayName: 'Piece Trigger',
            type: FlowTriggerType.PIECE,
            settings: {
                pieceName: '@inboxfm-connect/piece-schedule',
                pieceVersion: '0.1.0',
                triggerName: 'cron',
                input: { cron: '0 0 * * *' },
                propertySettings: {},
                sampleData: { sampleDataFileId: 'file-123' },
            },
            lastUpdatedDate: '2026-01-01T00:00:00.000Z',
        }
        const flow = createMockFlowVersion(pieceTrigger)

        const updated = _updateTrigger(flow, {
            name: 'trigger',
            displayName: 'Updated Piece Trigger',
            type: FlowTriggerType.PIECE,
            settings: {
                pieceName: '@inboxfm-connect/piece-schedule',
                pieceVersion: '0.2.0',
                triggerName: 'cron',
                input: { cron: '*/5 * * * *' },
                propertySettings: {},
            },
            valid: true,
        })

        expect((updated.trigger as PieceTrigger).settings.sampleData).toEqual({ sampleDataFileId: 'file-123' })
    })
})

describe('name-uniqueness invariants hold for composite operations', () => {
    it('MOVE_ACTION can still re-add the moved step under its original name after delete', () => {
        const step1 = createMockCodeAction('step_1')
        const step2 = createMockCodeAction('step_2')
        step1.nextAction = step2
        const flow = createMockFlowVersion(createMockEmptyTrigger('trigger', step1))

        const result = flowOperations.apply(flow, {
            type: FlowOperationType.MOVE_ACTION,
            request: {
                name: 'step_1',
                newParentStep: 'step_2',
                stepLocationRelativeToNewParent: StepLocationRelativeToParent.AFTER,
            },
        })

        expect(flowStructureUtil.getAllSteps(result.trigger).map((s) => s.name)).toEqual(['trigger', 'step_2', 'step_1'])
    })

    it('duplicate-step still generates fresh names that never collide', () => {
        const step1 = createMockCodeAction('step_1')
        const flow = createMockFlowVersion(createMockEmptyTrigger('trigger', step1))

        const result = flowOperations.apply(flow, {
            type: FlowOperationType.DUPLICATE_ACTION,
            request: { stepName: 'step_1' },
        })

        expect(flowStructureUtil.getAllSteps(result.trigger).map((s) => s.name).sort()).toEqual(['step_1', 'step_2', 'trigger'])
    })
})
