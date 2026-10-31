import dayjs from 'dayjs'
import { isNil } from '@inboxfm-connect/core-utils'
import { ActivepiecesError, ErrorCode } from '@inboxfm-connect/core-utils'
import { FlowAction, FlowActionType, LoopOnItemsAction, RouterAction, SingleActionSchema } from '../actions/action'
import { FlowVersion } from '../flow-version'
import { flowStructureUtil, Step } from '../util/flow-structure-util'
import { AddActionRequest, StepLocationRelativeToParent, UpdateActionRequest } from './index'

type ActionCreationProps = {
    nextAction?: FlowAction
}

function createAction(request: UpdateActionRequest, {
    nextAction,
}: ActionCreationProps): FlowAction {
    const baseProperties = {
        displayName: request.displayName,
        name: request.name,
        valid: false,
        skip: request.skip,
        lastUpdatedDate: dayjs().toISOString(),
        settings: {
            ...request.settings,
            customLogoUrl: request.settings.customLogoUrl,
        },
        nextAction,
    }
    let action: FlowAction
    switch (request.type) {
        case FlowActionType.ROUTER:
            action = {
                ...baseProperties,
                type: FlowActionType.ROUTER,
                settings: request.settings,
                children: request.settings.branches.map(() => null),
            }

            break
        case FlowActionType.LOOP_ON_ITEMS:
            action = {
                ...baseProperties,
                type: FlowActionType.LOOP_ON_ITEMS,
                settings: request.settings,
            }
            break
        case FlowActionType.PIECE:
            action = {
                ...baseProperties,
                type: FlowActionType.PIECE,
                settings: request.settings,
            }
            break
        case FlowActionType.CODE:
            action = {
                ...baseProperties,
                type: FlowActionType.CODE,
                settings: request.settings,
            }
            break
    }
    const parseResult = SingleActionSchema.safeParse(action)
    const valid = (isNil(request.valid) ? true : request.valid) && parseResult.success
    return {
        ...action,
        valid,
    }
}

function handleLoopOnItems(parentStep: LoopOnItemsAction, request: AddActionRequest): Step {
    if (request.stepLocationRelativeToParent === StepLocationRelativeToParent.INSIDE_LOOP) {
        parentStep.firstLoopAction = createAction(request.action, {
            nextAction: parentStep.firstLoopAction,
        })
    }
    else if (request.stepLocationRelativeToParent === StepLocationRelativeToParent.AFTER) {
        parentStep.nextAction = createAction(request.action, {
            nextAction: parentStep.nextAction,
        })
    }
    else {
        throw new ActivepiecesError(
            {
                code: ErrorCode.FLOW_OPERATION_INVALID,
                params: {
                    message: `Loop step parent ${request.stepLocationRelativeToParent} not found`,
                },
            })
    }
    return parentStep
}

function handleRouter(parentStep: RouterAction, request: AddActionRequest): Step {
    if (request.stepLocationRelativeToParent === StepLocationRelativeToParent.INSIDE_BRANCH && !isNil(request.branchIndex)) {
        // The router's children array is index-aligned with settings.branches. An
        // out-of-range branchIndex used to be assigned directly into children,
        // producing a sparse array whose holes serialize to null — children and
        // branches fell out of sync, the added step became unreachable, and the
        // version still reported valid. Reject indexes that have no branch.
        if (request.branchIndex < 0 || request.branchIndex >= parentStep.settings.branches.length) {
            throw new ActivepiecesError({
                code: ErrorCode.FLOW_OPERATION_INVALID,
                params: {
                    message: `Cannot add step inside branch ${request.branchIndex} of router "${parentStep.name}": the router has ${parentStep.settings.branches.length} branches.`,
                },
            })
        }
        parentStep.children[request.branchIndex] = createAction(request.action, {
            nextAction: parentStep.children[request.branchIndex] ?? undefined,
        })
    }
    else if (request.stepLocationRelativeToParent === StepLocationRelativeToParent.AFTER) {
        parentStep.nextAction = createAction(request.action, {
            nextAction: parentStep.nextAction,
        })
    }
    else {
        throw new ActivepiecesError({
            code: ErrorCode.FLOW_OPERATION_INVALID,
            params: {
                message: `Router step parent ${request.stepLocationRelativeToParent} not found`,
            },
        })
    }
    return parentStep
}

function handleContinueOnFailureBranches(parentStep: Step, request: AddActionRequest): Step {
    if (parentStep.type !== FlowActionType.CODE && parentStep.type !== FlowActionType.PIECE) {
        throw new ActivepiecesError({
            code: ErrorCode.FLOW_OPERATION_INVALID,
            params: {
                message: `Continue-on-failure branches are only available on Code and Piece actions, got ${parentStep.type}`,
            },
        })
    }
    const branches = parentStep.continueOnFailureBranches ?? {}
    if (request.stepLocationRelativeToParent === StepLocationRelativeToParent.INSIDE_ON_SUCCESS_BRANCH) {
        branches.onSuccess = createAction(request.action, {
            nextAction: branches.onSuccess,
        })
    }
    else if (request.stepLocationRelativeToParent === StepLocationRelativeToParent.INSIDE_ON_FAILURE_BRANCH) {
        branches.onFailure = createAction(request.action, {
            nextAction: branches.onFailure,
        })
    }
    parentStep.continueOnFailureBranches = branches
    return parentStep
}

function _addAction(flowVersion: FlowVersion, request: AddActionRequest): FlowVersion {
    // Steps are addressed by name everywhere (lookup, updates, deletes, execution
    // output keys, mustache references), so a duplicate name makes every one of
    // those ambiguous. The name "trigger" is worse: the transfer walks by name, so
    // re-adding a step whose name matches the matched parent re-triggers the add
    // on every visited step and recurses until the stack overflows. Enforce
    // uniqueness across all existing steps (the trigger's name included).
    if (flowStructureUtil.getAllSteps(flowVersion.trigger).some((step) => step.name === request.action.name)) {
        throw new ActivepiecesError({
            code: ErrorCode.FLOW_OPERATION_INVALID,
            params: {
                message: `Step name "${request.action.name}" is already used by another step in this flow (including the trigger). Step names must be unique.`,
            },
        })
    }
    // Adding a step under a parent that does not exist in the flow used to be a
    // silent no-op (transferFlow simply matched nothing), which made composed
    // operations — MOVE_ACTION batches, pastes with stale parent names, imports —
    // lose steps without any error while the version stayed valid. Fail loudly.
    if (!flowStructureUtil.getAllSteps(flowVersion.trigger).some((step) => step.name === request.parentStep)) {
        throw new ActivepiecesError({
            code: ErrorCode.ENTITY_NOT_FOUND,
            params: {
                entityType: 'step',
                entityId: request.parentStep,
                message: `Parent step "${request.parentStep}" not found`,
            },
        })
    }
    return flowStructureUtil.transferFlow(flowVersion, (parentStep: Step) => {
        if (parentStep.name !== request.parentStep) {
            return parentStep
        }
        if (
            request.stepLocationRelativeToParent === StepLocationRelativeToParent.INSIDE_ON_SUCCESS_BRANCH ||
            request.stepLocationRelativeToParent === StepLocationRelativeToParent.INSIDE_ON_FAILURE_BRANCH
        ) {
            return handleContinueOnFailureBranches(parentStep, request)
        }
        switch (parentStep.type) {
            case FlowActionType.LOOP_ON_ITEMS:
                return handleLoopOnItems(parentStep, request)
            case FlowActionType.ROUTER:
                return handleRouter(parentStep, request)
            default: {
                parentStep.nextAction = createAction(request.action, {
                    nextAction: parentStep.nextAction,
                })
                return parentStep
            }
        }
    })
}

export { _addAction }

