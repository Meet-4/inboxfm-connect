import { isNil, isObject } from '@inboxfm-connect/core-utils'
import { getAuthPropertyForValue, InputPropertyMap, IntegrationProperty, PieceAuthProperty, PiecePropertyMap, PropertyType, StaticPropsValue } from '@inboxfm-connect/pieces-framework'
import { AppConnectionValue, AUTHENTICATION_PROPERTY_NAME, PropertySettings } from '@inboxfm-connect/shared'
import { processors } from './processors'
import { arrayZipperProcessor } from './processors/array-zipper'

type PropsValidationError = {
    [key: string]: string[] | PropsValidationError | PropsValidationError[]
}

export const propsProcessor = {
    applyProcessorsAndValidators: async (
        resolvedInput: StaticPropsValue<PiecePropertyMap>,
        props: InputPropertyMap,
        auth: PieceAuthProperty | PieceAuthProperty[] | undefined,
        requireAuth: boolean,
        propertySettings: Record<string, PropertySettings>,
    ): Promise<{ processedInput: StaticPropsValue<PiecePropertyMap>, errors: PropsValidationError }> => {
        let dynamaicPropertiesSchema: Record<string, InputPropertyMap> | undefined = undefined
        if (Object.keys(propertySettings).length > 0) {
            dynamaicPropertiesSchema = Object.fromEntries(Object.entries(propertySettings).map(([key, propertySetting]) => [key, propertySetting.schema]))
        }
        const processedInput = { ...resolvedInput }
        const errors: PropsValidationError = {}
        const authValue: AppConnectionValue | undefined = resolvedInput[AUTHENTICATION_PROPERTY_NAME]
        if (authValue && requireAuth) {
            const authPropsToProcess = getAuthPropsToProcess(authValue, auth)
            if (authPropsToProcess) {
                // V1+ pieces receive the connection value as a `{ type, props }` envelope;
                // V0 pieces (undefined context version) get the bare props object. The
                // processors/validators are keyed by the auth property names, so they must
                // run against the field map itself — recursing on the envelope matched no
                // property at all, leaving number/JSON/date auth fields unparsed and
                // required auth fields unvalidated for every wrapped connection.
                const { authProps, rebuildAuthValue } = unwrapAuthProps(authValue)
                const { processedInput: authProcessedInput, errors: authErrors } = await propsProcessor.applyProcessorsAndValidators(
                    authProps as StaticPropsValue<PiecePropertyMap>,
                    authPropsToProcess,
                    undefined,
                    false,
                    {},
                )
                processedInput[AUTHENTICATION_PROPERTY_NAME] = rebuildAuthValue(authProcessedInput)
                if (Object.keys(authErrors).length > 0) {
                    errors[AUTHENTICATION_PROPERTY_NAME] = authErrors
                }
            }
        }
        for (const [key, value] of Object.entries(resolvedInput)) {
            const property = props[key]
            if (isNil(property)) {
                continue
            }
            // Only recurse into values shaped like the schema expects: a DYNAMIC value is
            // an object of fields and an ARRAY value is either a list or, from the builder,
            // an object of per-field arrays that gets zipped. Anything else (a string, a
            // number, a nested array) used to be spread key-by-key into a fabricated object
            // — `'oops'` became `{ 0: 'o', 1: 'o', 2: 'p', 3: 's' }` and `[1, 2]` became
            // `[{}, {}]` — silently replacing the caller's value with garbage the piece
            // then used as if it were valid input.
            if (property.type === PropertyType.DYNAMIC && !isNil(dynamaicPropertiesSchema?.[key]) && isObject(value)) {
                const { processedInput: itemProcessedInput, errors: itemErrors } = await propsProcessor.applyProcessorsAndValidators(
                    value,
                    dynamaicPropertiesSchema[key],
                    undefined,
                    false,
                    {},
                )
                processedInput[key] = itemProcessedInput
                if (Object.keys(itemErrors).length > 0) {
                    errors[key] = itemErrors
                }
            }
            if (property.type === PropertyType.ARRAY && property.properties && (Array.isArray(value) || isObject(value))) {
                const arrayOfObjects = arrayZipperProcessor(property, value) ?? []
                const processedArray = []
                const processedErrors = []
                for (const item of arrayOfObjects) {
                    if (!isObject(item)) {
                        // An array item that is not an object cannot satisfy a nested
                        // property schema; keep it as the user supplied it instead of
                        // collapsing it into `{}` and reporting a valid-looking run.
                        processedArray.push(item)
                        processedErrors.push({})
                        continue
                    }
                    const { processedInput: itemProcessedInput, errors: itemErrors } = await propsProcessor.applyProcessorsAndValidators(
                        item,
                        property.properties,
                        undefined,
                        false,
                        {},
                    )
                    processedArray.push(itemProcessedInput)
                    processedErrors.push(itemErrors)
                }
                processedInput[key] = processedArray
                const isThereErrors = processedErrors.some(error => Object.keys(error).length > 0)
                if (isThereErrors) {
                    errors[key] = {
                        properties: processedErrors,
                    }
                }
            }
            const processor = processors[property.type]
            if (processor) {
                processedInput[key] = await processor(property, processedInput[key])
            }
        }

        for (const [key, value] of Object.entries(processedInput)) {
            const property = props[key]
            if (isNil(property)) {
                continue
            }

            const validationErrors = validateProperty(property, value, resolvedInput[key])
            if (validationErrors.length > 0) {
                errors[key] = validationErrors
            }
        }

        return { processedInput, errors }
    },
}

const validateProperty = (property: IntegrationProperty, value: unknown, originalValue: unknown): string[] => {
    if (property.type === PropertyType.JSON) {
        if (!property.required && originalValue === '') {
            return []
        }
        if (!isNil(originalValue) && isNil(value)) {
            return [`Expected JSON, received: ${originalValue}`]
        }
        if (!property.required && isNil(value)) {
            return []
        }
        if (!isObject(value) && !Array.isArray(value)) {
            return [`Expected JSON, received: ${originalValue}`]
        }
        return []
    }

    if (!property.required && isNil(value)) {
        return []
    }

    switch (property.type) {
        case PropertyType.SHORT_TEXT:
        case PropertyType.LONG_TEXT:
            return typeof value === 'string' ? [] : [`Expected string, received: ${originalValue}`]
        case PropertyType.NUMBER:
            return typeof value === 'number' && !Number.isNaN(value) ? [] : [`Expected number, received: ${originalValue}`]
        case PropertyType.CHECKBOX:
            return typeof value === 'boolean' ? [] : [`Expected boolean, received: ${originalValue}`]
        case PropertyType.DATE_TIME:
            return typeof value === 'string' ? [] : [`Invalid datetime format. Expected ISO format (e.g. 2024-03-14T12:00:00.000Z), received: ${originalValue}`]
        case PropertyType.ARRAY:
            return Array.isArray(value) ? [] : [`Expected array, received: ${originalValue}`]
        case PropertyType.OBJECT:
            return isObject(value) ? [] : [`Expected object, received: ${originalValue}`]
        case PropertyType.FILE:
            return isObject(value) ? [] : [`Expected file url or base64 with mimeType, received: ${originalValue}`]
        default:
            return []
    }
}

function getAuthPropsToProcess(authValue: AppConnectionValue, auth: PieceAuthProperty | PieceAuthProperty[] | undefined): InputPropertyMap | null {
    if (isNil(auth)) {
        return null
    }
    const usedAuthProperty = getAuthPropertyForValue({
        authValueType: authValue.type,
        integrationAuth: auth,
    })
    const doesAuthHaveProps = usedAuthProperty?.type === PropertyType.CUSTOM_AUTH || usedAuthProperty?.type === PropertyType.OAUTH2 || usedAuthProperty?.type === PropertyType.OIDC
    if (doesAuthHaveProps && !isNil(usedAuthProperty?.props)) {
        return usedAuthProperty.props
    }
    return null
}

/**
 * Splits a connection value into the auth field map the processors expect and a
 * rebuild function that puts the processed fields back into the original shape.
 * Wrapped (`{ type, props }`) values keep their envelope — dropping it would hand a
 * V1 piece a bare props object and lose `access_token`/`data` for OAuth2.
 */
function unwrapAuthProps(authValue: AppConnectionValue): { authProps: Record<string, unknown>, rebuildAuthValue: (processed: StaticPropsValue<PiecePropertyMap>) => AppConnectionValue } {
    const wrappedProps = (authValue as { props?: unknown }).props
    if (!isNil((authValue as { type?: unknown }).type) && isObject(wrappedProps)) {
        return {
            authProps: wrappedProps,
            rebuildAuthValue: (processed) => ({ ...authValue, props: processed }) as AppConnectionValue,
        }
    }
    return {
        authProps: authValue as unknown as Record<string, unknown>,
        rebuildAuthValue: (processed) => processed as unknown as AppConnectionValue,
    }
}