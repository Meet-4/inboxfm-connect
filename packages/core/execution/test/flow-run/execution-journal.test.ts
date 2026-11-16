import { describe, expect, it } from 'vitest'
import { FlowActionType } from '../../src/lib/flows/actions/action'
import { FlowTriggerType } from '../../src/lib/flows/triggers/trigger'
import { executionJournal } from '../../src/lib/flow-run/execution/execution-journal'
import { GenericStepOutput, LoopStepOutput, StepOutput, StepOutputStatus } from '../../src/lib/flow-run/execution/step-output'

describe('executionJournal (Issue #141)', () => {
    describe('upsertStep & getStep', () => {
        it('upserts and retrieves a top-level step output', () => {
            const steps: Record<string, StepOutput> = {}
            const triggerOutput = GenericStepOutput.create({
                type: FlowTriggerType.WEBHOOK,
                status: StepOutputStatus.SUCCEEDED,
                input: { body: 'sample' },
                output: { received: true },
            })

            executionJournal.upsertStep({
                stepName: 'trigger',
                stepOutput: triggerOutput,
                path: [],
                steps,
            })

            const retrieved = executionJournal.getStep({
                stepName: 'trigger',
                path: [],
                steps,
            })

            expect(retrieved).toBeDefined()
            expect(retrieved?.status).toBe(StepOutputStatus.SUCCEEDED)
            expect(retrieved?.output).toEqual({ received: true })
        })

        it('upserts a step inside an existing loop iteration', () => {
            const loopStep = LoopStepOutput.init({ input: [1, 2] }).setItemAndIndex({ item: 1, index: 0 }).addIteration()
            const steps: Record<string, StepOutput> = {
                loop_1: loopStep,
            }

            const innerAction = GenericStepOutput.create({
                type: FlowActionType.PIECE,
                status: StepOutputStatus.SUCCEEDED,
                input: { msg: 'inside loop' },
                output: { sent: true },
            })

            executionJournal.upsertStep({
                stepName: 'send_slack',
                stepOutput: innerAction,
                path: [['loop_1', 0]],
                steps,
            })

            const retrieved = executionJournal.getStep({
                stepName: 'send_slack',
                path: [['loop_1', 0]],
                steps,
            })

            expect(retrieved).toBeDefined()
            expect(retrieved?.output).toEqual({ sent: true })
        })

        it('auto-creates loop step and iteration when createLoopIterationIfNotExists is true', () => {
            const steps: Record<string, StepOutput> = {}
            const innerAction = GenericStepOutput.create({
                type: FlowActionType.PIECE,
                status: StepOutputStatus.SUCCEEDED,
                input: {},
                output: { ok: true },
            })

            executionJournal.upsertStep({
                stepName: 'inner_step',
                stepOutput: innerAction,
                path: [['dynamic_loop', 0]],
                steps,
                createLoopIterationIfNotExists: true,
            })

            expect(steps.dynamic_loop).toBeDefined()
            expect(steps.dynamic_loop.type).toBe(FlowActionType.LOOP_ON_ITEMS)

            const retrieved = executionJournal.getStep({
                stepName: 'inner_step',
                path: [['dynamic_loop', 0]],
                steps,
            })
            expect(retrieved?.output).toEqual({ ok: true })
        })

        it('creates and RETAINS iteration 1 when the loop has no iterations yet (skip-ahead)', () => {
            const steps: Record<string, StepOutput> = {}
            const innerAction = GenericStepOutput.create({
                type: FlowActionType.PIECE,
                status: StepOutputStatus.SUCCEEDED,
                input: {},
                output: { ok: true },
            })

            executionJournal.upsertStep({
                stepName: 'inner_step',
                stepOutput: innerAction,
                path: [['loop', 1]],
                steps,
                createLoopIterationIfNotExists: true,
            })

            // addIteration() appends a single `{}` at the end of the array, so
            // the old code wrote into a throwaway object for index > 0 and the
            // step output was silently lost.
            const retrieved = executionJournal.getStep({
                stepName: 'inner_step',
                path: [['loop', 1]],
                steps,
            })
            expect(retrieved?.output).toEqual({ ok: true })
        })

        it('pads iterations up to a jump-ahead index instead of dropping the write', () => {
            const loopStep = LoopStepOutput.init({ input: [] }).setItemAndIndex({ item: undefined, index: 0 }).addIteration()
            const steps: Record<string, StepOutput> = { loop: loopStep }
            const innerAction = GenericStepOutput.create({
                type: FlowActionType.PIECE,
                status: StepOutputStatus.SUCCEEDED,
                input: {},
                output: { ok: 1 },
            })

            executionJournal.upsertStep({
                stepName: 'far_step',
                stepOutput: innerAction,
                path: [['loop', 3]],
                steps,
                createLoopIterationIfNotExists: true,
            })

            expect((steps.loop as LoopStepOutput).output?.iterations.length).toBe(4)
            const retrieved = executionJournal.getStep({
                stepName: 'far_step',
                path: [['loop', 3]],
                steps,
            })
            expect(retrieved?.output).toEqual({ ok: 1 })
        })
    })

    describe('getStateAtPath & getOrCreateStateAtPath', () => {
        it('throws error when intermediate step in path does not exist', () => {
            const steps: Record<string, StepOutput> = {}
            expect(() => executionJournal.getStateAtPath({ path: [['missing_loop', 0]], steps })).toThrow(
                'Step missing_loop not found in path missing_loop,0',
            )
        })

        it('throws error when step in path is not a LOOP_ON_ITEMS action', () => {
            const steps: Record<string, StepOutput> = {
                not_a_loop: GenericStepOutput.create({
                    type: FlowActionType.PIECE,
                    status: StepOutputStatus.SUCCEEDED,
                    input: {},
                }),
            }
            expect(() => executionJournal.getStateAtPath({ path: [['not_a_loop', 0]], steps })).toThrow(
                'Step not_a_loop is not a loop on items step in path not_a_loop,0',
            )
        })

        it('throws error when iteration index in path does not exist', () => {
            const loopStep = LoopStepOutput.init({ input: [] })
            const steps: Record<string, StepOutput> = { loop_empty: loopStep }
            expect(() => executionJournal.getStateAtPath({ path: [['loop_empty', 5]], steps })).toThrow(
                'Iteration 5 not found in path loop_empty,5',
            )
        })
    })

    describe('findLastStepWithStatus', () => {
        it('finds the last executed step matching specified status', () => {
            const steps: Record<string, StepOutput> = {
                step_1: GenericStepOutput.create({ type: FlowActionType.PIECE, status: StepOutputStatus.SUCCEEDED, input: {} }),
                step_2: GenericStepOutput.create({ type: FlowActionType.PIECE, status: StepOutputStatus.FAILED, input: {} }),
                step_3: GenericStepOutput.create({ type: FlowActionType.PIECE, status: StepOutputStatus.SUCCEEDED, input: {} }),
            }

            expect(executionJournal.findLastStepWithStatus(steps, StepOutputStatus.FAILED)).toBe('step_2')
            expect(executionJournal.findLastStepWithStatus(steps, StepOutputStatus.SUCCEEDED)).toBe('step_3')
        })

        it('finds the last executed step inside nested loop iterations', () => {
            const loopStep = LoopStepOutput.init({ input: [1] }).setItemAndIndex({ item: 1, index: 0 }).addIteration()
            const innerFailed = GenericStepOutput.create({ type: FlowActionType.PIECE, status: StepOutputStatus.FAILED, input: {} })

            executionJournal.upsertStep({
                stepName: 'nested_failed_step',
                stepOutput: innerFailed,
                path: [['loop_container', 0]],
                steps: { loop_container: loopStep },
            })

            const lastFailed = executionJournal.findLastStepWithStatus({ loop_container: loopStep }, StepOutputStatus.FAILED)
            expect(lastFailed).toBe('nested_failed_step')
        })
    })

    describe('isChildOf & getPathToStep', () => {
        it('correctly identifies descendant step in loop hierarchy', () => {
            const loopStep = LoopStepOutput.init({ input: [1] }).setItemAndIndex({ item: 1, index: 0 }).addIteration()
            const innerAction = GenericStepOutput.create({ type: FlowActionType.PIECE, status: StepOutputStatus.SUCCEEDED, input: {} })
            const steps: Record<string, StepOutput> = { loop_outer: loopStep }

            executionJournal.upsertStep({
                stepName: 'child_action',
                stepOutput: innerAction,
                path: [['loop_outer', 0]],
                steps,
            })

            expect(executionJournal.isChildOf(steps.loop_outer, 'child_action')).toBe(true)
            expect(executionJournal.isChildOf(steps.loop_outer, 'non_existent_child')).toBe(false)
        })

        it('computes exact path to step inside nested loop structure', () => {
            const loopStep = LoopStepOutput.init({ input: [1] }).setItemAndIndex({ item: 1, index: 0 }).addIteration()
            const steps: Record<string, StepOutput> = { loop_1: loopStep }

            const innerAction = GenericStepOutput.create({ type: FlowActionType.PIECE, status: StepOutputStatus.SUCCEEDED, input: {} })
            executionJournal.upsertStep({
                stepName: 'deep_step',
                stepOutput: innerAction,
                path: [['loop_1', 0]],
                steps,
            })

            const path = executionJournal.getPathToStep(steps, 'deep_step', { loop_1: 0 })
            expect(path).toEqual([['loop_1', 0]])
        })
    })
})
