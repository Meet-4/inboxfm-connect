import { ToolContext } from ".";
import { InputPropertyMap, IntegrationAuthProperty } from "../property";

export enum ContextVersion {
    V1 = '1',
    V2 = '2',
}
// When introducing a new context version, bump BOTH constants together.
// The floor is load-bearing: older engines bundle an older framework whose
// switch below only knows the older ContextVersion cases. A piece compiled
// against a newer framework reports the new version via getContextInfo(),
// the switch falls through, returns undefined, and the engine then invokes
// run(undefined) — surfacing as "Cannot read properties of undefined".
// Enforcing the floor in piece.ts keeps such pieces out of the registry on
// incompatible servers instead of crashing at execution time.
export const LATEST_CONTEXT_VERSION = ContextVersion.V2;
export const MINIMUM_SUPPORTED_RELEASE_AFTER_LATEST_CONTEXT_VERSION = '0.82.0';

export const backwardCompatabilityContextUtils = {
    makeActionContextBackwardCompatible({ context, contextVersion }: MakeActionContextBackwardCompatibleParams): ToolContext<IntegrationAuthProperty, InputPropertyMap> {
        switch (contextVersion) {
            case ContextVersion.V2:
                return context;
            case ContextVersion.V1:
                return addLegacyMethods({ context });
            case undefined:
                return addLegacyMethodsAndServerUrl({ context });
        }
    },
}

function addLegacyMethods({ context }: { context: ToolContext<IntegrationAuthProperty, InputPropertyMap> }): ToolContext<IntegrationAuthProperty, InputPropertyMap> {
    return {
        ...context,
        generateResumeUrl: buildLegacyGenerateResumeUrl({ context }),
    }
}

function addLegacyMethodsAndServerUrl({ context }: { context: ToolContext<IntegrationAuthProperty, InputPropertyMap> }): ToolContext<IntegrationAuthProperty, InputPropertyMap> {
    return {
        ...addLegacyMethods({ context }),
        serverUrl: context.server.publicUrl,
    } as unknown as ToolContext<IntegrationAuthProperty, InputPropertyMap>
}

/**
 * @deprecated Since 2026-04-12. Remove after 2026-10-12 once all pieces migrate to createWaitpoint/waitForWaitpoint.
 */
function buildLegacyGenerateResumeUrl({ context }: { context: ToolContext<IntegrationAuthProperty, InputPropertyMap> }): (params: { queryParams: Record<string, string>, sync?: boolean }) => string {
    return (params) => {
        const randomId = Math.random().toString(36).substring(2)
        const url = new URL(`${context.server.publicUrl}v1/flow-runs/${context.run.id}/requests/${randomId}${params.sync ? '/sync' : ''}`)
        url.search = new URLSearchParams(params.queryParams).toString()
        return url.toString()
    }
}

type MakeActionContextBackwardCompatibleParams = {
    context: ToolContext<IntegrationAuthProperty, InputPropertyMap>;
    contextVersion: ContextVersion | undefined;
}
