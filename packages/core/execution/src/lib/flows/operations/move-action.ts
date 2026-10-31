import { ActivepiecesError, ErrorCode } from '@inboxfm-connect/core-utils'
import { FlowVersion } from '../flow-version'
import { flowStructureUtil } from '../util/flow-structure-util'
import { _getImportOperations } from './import-flow'
import { FlowOperationRequest, FlowOperationType, MoveActionRequest } from './index'


export function _moveAction(flowVersion: FlowVersion, request: MoveActionRequest): FlowOperationRequest[] {
    const sourceStep = flowStructureUtil.getActionOrThrow(request.name, flowVersion.trigger)
    flowStructureUtil.getStepOrThrow(request.newParentStep, flowVersion.trigger)

    // The move is applied as DELETE followed by ADD. If the new parent is the moved
    // step itself or lives inside the moved step's subtree (loop body, router branch,
    // continue-on-failure branch), the DELETE drops that parent — and the ADD then
    // silently no-ops, permanently destroying the moved step and its whole subtree
    // while leaving the flow version valid and publishable. Reject up front instead.
    if (
        request.newParentStep === request.name ||
        flowStructureUtil.isChildOf(sourceStep, request.newParentStep)
    ) {
        throw new ActivepiecesError({
            code: ErrorCode.FLOW_OPERATION_INVALID,
            params: {
                message: `Cannot move step "${request.name}": the new parent step "${request.newParentStep}" is the step itself or one of its descendants. Moving a step into its own subtree would delete the step and everything inside it.`,
            },
        })
    }

    const sourceStepWithoutNextAction = {
        ...sourceStep,
        nextAction: undefined,
    }
    const deleteOperations: FlowOperationRequest[] = [
        {
            type: FlowOperationType.DELETE_ACTION,
            request: {
                names: [request.name],
            },
        },
    ]
    const addOperations: FlowOperationRequest[] = [
        {
            type: FlowOperationType.ADD_ACTION,
            request: {
                action: sourceStepWithoutNextAction,
                parentStep: request.newParentStep,
                stepLocationRelativeToParent: request.stepLocationRelativeToNewParent,
                branchIndex: request.branchIndex,
            },
        },
        ..._getImportOperations(sourceStepWithoutNextAction),
    ]
    return [
        ...deleteOperations,
        ...addOperations,
    ]
}