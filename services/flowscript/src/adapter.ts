export interface FlowIntegrationExecutor {
  execute(input: {
    projectId: string
    platformId: string
    integrationName: string
    actionName: string
    connectionId: string
    input: Record<string, unknown>
    runId: string
    stepId: string
    idempotencyKey?: string
  }): Promise<unknown>
}

export type IntegrationErrorClassification =
  | 'VALIDATION_ERROR'
  | 'INTEGRATION_NOT_FOUND'
  | 'ACTION_NOT_FOUND'
  | 'CONNECTION_NOT_FOUND'
  | 'CROSS_PROJECT_FORBIDDEN'
  | 'RATE_LIMITED'
  | 'AUTHENTICATION_EXPIRED'
  | 'PROVIDER_ERROR'
  | 'TIMEOUT'
  | 'ENGINE_OPERATION_FAILURE'

export class FlowIntegrationError extends Error {
  constructor(
    public readonly code: IntegrationErrorClassification,
    message: string,
    public readonly details?: {
      integrationName?: string
      actionName?: string
      connectionId?: string
      projectId?: string
      platformId?: string
      stepId?: string
      runId?: string
      retryable?: boolean
      status?: number
    },
  ) {
    super(`[${code}] ${message}`)
    this.name = 'FlowIntegrationError'
  }
}

export type PieceMetadataServiceLike = {
  getPiece(params: { name: string; version?: string; platformId?: string }): Promise<{
    name: string
    version: string
    actions: Record<string, {
      name: string
      displayName: string
      props?: Record<string, unknown>
      requireAuth?: boolean
    }>
  } | null>
}

export type AppConnectionLookupLike = {
  getConnection(params: {
    connectionId: string
    projectId: string
    platformId: string
    pieceName: string
  }): Promise<{
    id: string
    projectId: string
    platformId: string
    pieceName: string
    pieceVersion?: string
    externalId?: string
  } | null>
}

export type HeadlessRuntimeLike = {
  execute(params: {
    integration: string
    tool: string
    connectionId: string
    input: Record<string, unknown>
    projectId: string
    platformId: string
    idempotencyKey?: string
    internalApiUrl?: string
    publicApiUrl?: string
  }): Promise<unknown>
}

export interface ConnectFlowIntegrationExecutorOptions {
  pieceMetadata: PieceMetadataServiceLike
  connectionLookup: AppConnectionLookupLike
  runtime: HeadlessRuntimeLike
  internalApiUrl?: string
  publicApiUrl?: string
  logger?: {
    info(obj: Record<string, unknown>, msg?: string): void
    error(obj: Record<string, unknown>, msg?: string): void
    warn(obj: Record<string, unknown>, msg?: string): void
  }
}

const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /credential/i,
  /api[_-]?key/i,
  /auth/i,
  /bearer/i,
  /private[_-]?key/i,
]

const FORBIDDEN_INPUT_CREDENTIAL_KEYS = new Set([
  'auth',
  'access_token',
  'accesstoken',
  'token',
  'secret',
  'password',
  'api_key',
  'apikey',
  'credentials',
  'private_key',
  'privatekey',
])

function findForbiddenCredentialKey(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findForbiddenCredentialKey(item)
      if (found) return found
    }
    return null
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[-_]/g, '')
    if (FORBIDDEN_INPUT_CREDENTIAL_KEYS.has(key) || FORBIDDEN_INPUT_CREDENTIAL_KEYS.has(normalized)) {
      return key
    }
    const nested = findForbiddenCredentialKey(value)
    if (nested) return nested
  }
  return null
}

export function redactSensitiveData(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    let sanitized = value.replace(/Bearer\s+(?:token\s+)?([A-Za-z0-9_.\-]+)/gi, 'Bearer [REDACTED]')
    sanitized = sanitized.replace(/(api[_-]?key|secret|password|token|bearer)\s*[:=\s]\s*['"]?[A-Za-z0-9_.\-]+['"]?/gi, '$1=[REDACTED]')
    sanitized = sanitized.replace(/sk_live_[A-Za-z0-9_]+/gi, '[REDACTED]')
    return sanitized
  }
  if (Array.isArray(value)) {
    return value.map(item => redactSensitiveData(item))
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERNS.some(p => p.test(key))) {
        result[key] = '[REDACTED]'
      } else {
        result[key] = redactSensitiveData(val)
      }
    }
    return result
  }
  return value
}

type StructuredErrorFields = {
  status?: unknown
  statusCode?: unknown
  status_code?: unknown
  httpStatus?: unknown
  code?: unknown
  response?: unknown
  cause?: unknown
}

/**
 * Reads an HTTP status from the structured fields providers actually use.
 *
 * Substring matching on the message ("... 401 ...") is unreliable: a quota error
 * such as "Error 1401: quota exceeded" or a transport error such as
 * "connection reset 4010" used to classify as an expired connection. Numeric
 * substrings are only honoured as whole tokens, and structured fields win.
 */
export function extractProviderStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const fields = error as StructuredErrorFields
  const response = fields.response && typeof fields.response === 'object'
    ? fields.response as { status?: unknown; statusCode?: unknown }
    : undefined
  const cause = fields.cause && typeof fields.cause === 'object'
    ? fields.cause as { status?: unknown }
    : undefined
  return toHttpStatus(fields.status)
    ?? toHttpStatus(fields.statusCode)
    ?? toHttpStatus(fields.status_code)
    ?? toHttpStatus(fields.httpStatus)
    ?? toHttpStatus(response?.status)
    ?? toHttpStatus(response?.statusCode)
    ?? toHttpStatus(cause?.status)
}

function toHttpStatus(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599) return value
  if (typeof value === 'string' && /^[1-5]\d{2}$/.test(value.trim())) return Number(value.trim())
  return undefined
}

const RATE_LIMIT_CODE_PATTERN = /^(?:rate[_-]?limit(?:ed|_exceeded|_error)?|too_many_requests|throttled|insufficient_quota|quota_exceeded)$/
const AUTH_CODE_PATTERN = /^(?:unauthorized|authentication_error|invalid_api_key|invalid_authentication|invalid_token|token_expired|expired_token|permission_denied|forbidden)$/
const VALIDATION_CODE_PATTERN = /^(?:invalid_request_error|validation_error|context_length_exceeded|bad_request|unprocessable_entity)$/
const TIMEOUT_CODE_PATTERN = /^(?:etimedout|esockettimedout|timeout|request_timeout|deadline_exceeded)$/
const NETWORK_CODE_PATTERN = /^(?:econnreset|econnrefused|econnaborted|epipe|eai_again|enetunreach|enotfound|socket_hang_up)$/

const RATE_LIMIT_MESSAGE_PATTERNS = [
  /\b429\b/i,
  /\btoo many requests\b/i,
  /\brate[\s_-]?limit/i,
  /\bthrottl(?:ed|ing)\b/i,
  /\bquota\b/i,
]

const AUTH_MESSAGE_PATTERNS = [
  /\b40[13]\b/i,
  /\bunauthori[sz]ed\b/i,
  /\bforbidden\b/i,
  /\btoken[\s_-]?(?:has\s+)?expired\b/i,
  /\bexpired[\s_-]?token\b/i,
  /\binvalid[\s_-]?credentials\b/i,
  /\binvalid[\s_-]?(?:api[\s_-]?)?(?:token|key|client[\s_-]?id)\b/i,
  /\bauthentication (?:failed|required|error)\b/i,
]

const PROVIDER_MESSAGE_PATTERNS = [
  /\b50[0234]\b/i,
  /\bbad gateway\b/i,
  /\bgateway[\s_-]?time\s?out\b/i,
  /\bservice[\s_-]?unavailable\b/i,
  /\binternal server error\b/i,
  /\bupstream (?:error|failure|failed)\b/i,
]

const NETWORK_MESSAGE_PATTERNS = [
  /\bconnection reset\b/i,
  /\beconn(?:reset|refused|aborted)\b/i,
  /\bsocket hang up\b/i,
  /\bepipe\b/i,
  /\bnetwork error\b/i,
]

const TIMEOUT_MESSAGE_PATTERNS = [
  /\btime(?:d\s*)?out\b/i,
  /\betimedout\b/i,
]

function matchesAny(message: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(message))
}

function classifyHttpStatus(status: number): { code: IntegrationErrorClassification; retryable: boolean } | null {
  if (status === 429) return { code: 'RATE_LIMITED', retryable: true }
  if (status === 401 || status === 403) return { code: 'AUTHENTICATION_EXPIRED', retryable: false }
  if (status === 408) return { code: 'TIMEOUT', retryable: true }
  if (status >= 500 && status <= 599) return { code: 'PROVIDER_ERROR', retryable: true }
  if (status === 404) return { code: 'PROVIDER_ERROR', retryable: false }
  if (status === 400 || status === 422) return { code: 'VALIDATION_ERROR', retryable: false }
  if (status === 409 || status === 412) return { code: 'PROVIDER_ERROR', retryable: false }
  return null
}

export function classifyProviderError(error: unknown): { code: IntegrationErrorClassification; message: string; retryable: boolean } {
  if (error instanceof FlowIntegrationError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.details?.retryable ?? false,
    }
  }

  const rawMessage = error instanceof Error ? error.message : String(error)
  const status = extractProviderStatus(error)
  if (status !== undefined) {
    const classified = classifyHttpStatus(status)
    if (classified) {
      return { ...classified, message: rawMessage }
    }
  }

  const rawCode = error && typeof error === 'object' ? (error as StructuredErrorFields).code : undefined
  const structuredCode = typeof rawCode === 'string' ? rawCode.trim().toLowerCase() : undefined
  if (structuredCode) {
    if (RATE_LIMIT_CODE_PATTERN.test(structuredCode)) return { code: 'RATE_LIMITED', message: rawMessage, retryable: true }
    if (AUTH_CODE_PATTERN.test(structuredCode)) return { code: 'AUTHENTICATION_EXPIRED', message: rawMessage, retryable: false }
    if (VALIDATION_CODE_PATTERN.test(structuredCode)) return { code: 'VALIDATION_ERROR', message: rawMessage, retryable: false }
    if (TIMEOUT_CODE_PATTERN.test(structuredCode)) return { code: 'TIMEOUT', message: rawMessage, retryable: true }
    if (NETWORK_CODE_PATTERN.test(structuredCode)) return { code: 'PROVIDER_ERROR', message: rawMessage, retryable: true }
  }

  if (matchesAny(rawMessage, RATE_LIMIT_MESSAGE_PATTERNS)) {
    return { code: 'RATE_LIMITED', message: rawMessage, retryable: true }
  }
  if (matchesAny(rawMessage, AUTH_MESSAGE_PATTERNS)) {
    return { code: 'AUTHENTICATION_EXPIRED', message: rawMessage, retryable: false }
  }
  if (matchesAny(rawMessage, PROVIDER_MESSAGE_PATTERNS)) {
    return { code: 'PROVIDER_ERROR', message: rawMessage, retryable: true }
  }
  if (matchesAny(rawMessage, NETWORK_MESSAGE_PATTERNS)) {
    return { code: 'PROVIDER_ERROR', message: rawMessage, retryable: true }
  }
  if (matchesAny(rawMessage, TIMEOUT_MESSAGE_PATTERNS)) {
    return { code: 'TIMEOUT', message: rawMessage, retryable: true }
  }
  if (/\bconnection not found\b/i.test(rawMessage) || /\bentity_not_found\b/i.test(rawMessage) || /\bapp_connection_not_found\b/i.test(rawMessage)) {
    return { code: 'CONNECTION_NOT_FOUND', message: rawMessage, retryable: false }
  }
  if (/\b404\b/i.test(rawMessage) || /\bnot found\b/i.test(rawMessage)) {
    return { code: 'PROVIDER_ERROR', message: rawMessage, retryable: false }
  }

  return { code: 'ENGINE_OPERATION_FAILURE', message: rawMessage, retryable: false }
}

export class ConnectFlowIntegrationExecutor implements FlowIntegrationExecutor {
  constructor(private readonly options: ConnectFlowIntegrationExecutorOptions) {}

  async execute(input: {
    projectId: string
    platformId: string
    integrationName: string
    actionName: string
    connectionId: string
    input: Record<string, unknown>
    runId: string
    stepId: string
    idempotencyKey?: string
  }): Promise<unknown> {
    const { projectId, platformId, integrationName, actionName, connectionId, runId, stepId, idempotencyKey } = input
    const actionInput = input.input ?? {}

    // 1. Parameter presence validations
    if (!projectId) {
      throw new FlowIntegrationError('VALIDATION_ERROR', 'Project ID is required for integration execution', { stepId, runId, retryable: false })
    }
    if (!platformId) {
      throw new FlowIntegrationError('VALIDATION_ERROR', 'Platform ID is required for integration execution', { stepId, runId, retryable: false })
    }
    if (!integrationName) {
      throw new FlowIntegrationError('VALIDATION_ERROR', 'Integration name is required', { stepId, runId, retryable: false })
    }
    if (!actionName) {
      throw new FlowIntegrationError('VALIDATION_ERROR', 'Action name is required', { stepId, runId, retryable: false })
    }
    if (!connectionId) {
      throw new FlowIntegrationError('VALIDATION_ERROR', 'Connection ID is required for integration action execution', { stepId, runId, retryable: false })
    }

    // 2. Reject credentials in input (including nested objects)
    const forbiddenKey = findForbiddenCredentialKey(actionInput)
    if (forbiddenKey) {
      throw new FlowIntegrationError(
        'VALIDATION_ERROR',
        `Direct credential or auth property "${forbiddenKey}" is forbidden in FlowScript input for "${integrationName}.${actionName}". Use a configured connectionId instead.`,
        { integrationName, actionName, connectionId, stepId, runId, retryable: false },
      )
    }

    // 3. Validate connection ownership and platform/project scoping
    const connection = await this.options.connectionLookup.getConnection({
      connectionId,
      projectId,
      platformId,
      pieceName: integrationName,
    })
    if (!connection) {
      throw new FlowIntegrationError(
        'CONNECTION_NOT_FOUND',
        `Connection "${connectionId}" not found for piece "${integrationName}" in project "${projectId}"`,
        { connectionId, projectId, platformId, integrationName, stepId, runId, retryable: false },
      )
    }

    // 4. Metadata verification (pinned to connection's pieceVersion when present)
    const piece = await this.options.pieceMetadata.getPiece({
      name: integrationName,
      version: connection.pieceVersion,
      platformId,
    })
    if (!piece) {
      throw new FlowIntegrationError(
        'INTEGRATION_NOT_FOUND',
        `Integration "${integrationName}" was not found or is not available for platform "${platformId}"`,
        { integrationName, platformId, stepId, runId, retryable: false },
      )
    }

    const action = piece.actions[actionName]
    if (!action) {
      const available = Object.keys(piece.actions).join(', ')
      throw new FlowIntegrationError(
        'ACTION_NOT_FOUND',
        `Action "${actionName}" was not found on integration "${integrationName}". Available actions: ${available || '(none)'}`,
        { integrationName, actionName, stepId, runId, retryable: false },
      )
    }

    // 5. Check required action properties if metadata props are declared
    if (action.props && typeof action.props === 'object') {
      for (const [propName, propDef] of Object.entries(action.props)) {
        const isRequired = typeof propDef === 'object' && propDef !== null && (propDef as Record<string, unknown>).required === true
        if (isRequired && (actionInput[propName] === undefined || actionInput[propName] === null)) {
          throw new FlowIntegrationError(
            'VALIDATION_ERROR',
            `Missing required property "${propName}" for action "${integrationName}.${actionName}"`,
            { integrationName, actionName, connectionId, stepId, runId, retryable: false },
          )
        }
      }
    }

    // 6. Execute through Connect HeadlessRuntime
    try {
      this.options.logger?.info({
        integrationName,
        actionName,
        connectionId,
        projectId,
        runId,
        stepId,
        idempotencyKey,
      }, 'Executing integration action via HeadlessRuntime')

      const rawResult = await this.options.runtime.execute({
        integration: integrationName,
        tool: actionName,
        connectionId,
        input: actionInput,
        projectId,
        platformId,
        idempotencyKey,
        internalApiUrl: this.options.internalApiUrl,
        publicApiUrl: this.options.publicApiUrl,
      })

      return redactSensitiveData(rawResult)
    } catch (error) {
      const classified = classifyProviderError(error)
      const sanitizedMessage = redactSensitiveData(classified.message) as string

      this.options.logger?.error({
        error: sanitizedMessage,
        code: classified.code,
        integrationName,
        actionName,
        runId,
        stepId,
      }, 'Integration action execution failed')

      throw new FlowIntegrationError(
        classified.code,
        sanitizedMessage,
        {
          integrationName,
          actionName,
          connectionId,
          stepId,
          runId,
          retryable: classified.retryable,
        },
      )
    }
  }
}
