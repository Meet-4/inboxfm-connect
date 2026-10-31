import dayjs from 'dayjs'
import { ActivepiecesError, ErrorCode, isNil } from '@inboxfm-connect/core-utils'
import { FlowAction } from '../actions/action'
import { FlowVersion } from '../flow-version'
import { SampleDataSettings } from '../sample-data'
import { FlowTrigger, FlowTriggerType } from '../triggers/trigger'
import { flowStructureUtil } from '../util/flow-structure-util'
import { UpdateTriggerRequest } from '.'


function createTrigger(name: string, request: UpdateTriggerRequest, nextAction: FlowAction | undefined, existingSampleData: SampleDataSettings | undefined): FlowTrigger {
    const baseProperties = {
        displayName: request.displayName,
        name,
        valid: false,
        nextAction,
        lastUpdatedDate: dayjs().toISOString(),
    }
    let trigger: FlowTrigger
    switch (request.type) {
        case FlowTriggerType.EMPTY:
            trigger = {
                ...baseProperties,
                type: FlowTriggerType.EMPTY,
                settings: request.settings,
            }
            break
        case FlowTriggerType.PIECE:
            trigger = {
                ...baseProperties,
                type: FlowTriggerType.PIECE,
                settings: { ...request.settings, sampleData: existingSampleData },
            }
            break
    }
    const parseResult = FlowTrigger.safeParse(trigger)
    const valid = (isNil(request.valid) ? true : request.valid) && parseResult.success
    return {
        ...trigger,
        valid,
    }
}

function _updateTrigger(flowVersion: FlowVersion, request: UpdateTriggerRequest): FlowVersion {
    // Only the flow's root trigger can be updated. A request whose name matched any
    // step used to replace that step — including an action — with a trigger object,
    // grafting a second trigger into the middle of the tree while the version
    // stayed valid. Require the request to address the root trigger by name.
    if (flowVersion.trigger.name !== request.name) {
        throw new ActivepiecesError({
            code: ErrorCode.FLOW_OPERATION_INVALID,
            params: {
                message: `Cannot update trigger: "${request.name}" is not this flow's trigger step ("${flowVersion.trigger.name}"). Only the trigger can be updated with this operation.`,
            },
        })
    }
    const trigger = flowStructureUtil.getStepOrThrow(request.name, flowVersion.trigger)
    const existingSampleData = trigger.type === FlowTriggerType.PIECE ? trigger.settings.sampleData : undefined
    const updatedTrigger = createTrigger(request.name, request, trigger.nextAction, existingSampleData)
    const next = flowStructureUtil.transferFlow(flowVersion, (parentStep) => {
        if (parentStep.name === request.name && flowStructureUtil.isTrigger(parentStep.type)) {
            return updatedTrigger
        }
        return parentStep
    })
    return next
}

export { _updateTrigger }

