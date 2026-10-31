import type { FlowIR } from './compiler.js'
import { redactSensitiveData, FlowIntegrationError, type FlowIntegrationExecutor } from './adapter.js'
import { computeBackoff } from './store.js'

export type StepContext = { input: Record<string, unknown>; trigger: Record<string, unknown>; outputs: Record<string, unknown>; env: Record<string, string | undefined> }
export type IntegrationExecutor = (config: Record<string, unknown>, context: StepContext) => Promise<unknown>
export type RunResult = {
  status: 'succeeded' | 'failed' | 'cancelled'
  output?: unknown
  error?: string
  cancelled?: boolean
  steps: Array<{ id: string; status: 'succeeded' | 'skipped' | 'failed'; output?: unknown; error?: string; durationMs: number; attempts?: number }>
}

function resolvePath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current === null || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[key]
  }, value)
}

function resolveValue(value: unknown, context: StepContext): unknown {
  if (Array.isArray(value)) return value.map(item => resolveValue(item, context))
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (typeof obj.$ref === 'string') {
      const ref = obj.$ref
      if (ref.startsWith('input.')) return resolvePath(context.input, ref.slice(6))
      if (ref.startsWith('trigger.')) return resolvePath(context.trigger, ref.slice(8))
      if (ref.startsWith('steps.')) return resolvePath(context.outputs, ref.slice(6))
      throw new Error(`Unsupported reference "${ref}"`)
    }
    if (typeof obj.$env === 'string') {
      const resolved = context.env[obj.$env]
      if (resolved === undefined) throw new Error(`Missing environment variable "${obj.$env}"`)
      return resolved
    }
    return Object.fromEntries(Object.entries(obj).map(([key, item]) => [key, resolveValue(item, context)]))
  }
  return value
}

export type OutputBudget = {
  /** Maximum serialized byte estimate accepted for a single step output. */
  maxStepOutputBytes: number
  /** Maximum cumulative serialized byte estimate across every step output in a run. */
  maxRunOutputBytes: number
  /** Maximum container nesting accepted in any step or flow output. */
  maxOutputDepth: number
}

/**
 * Output-size knobs. `resolveValue` returns shared references, so referencing a
 * previous step output k times per step is free in memory — but the redaction
 * clone and the JSON.stringify in `finishRun` both materialize the full
 * expansion, which makes reference fan-out an exponential blowup. The budgets
 * below bound what the executor will buffer or persist.
 */
export function resolveOutputBudget(sourceEnv: Record<string, string | undefined> = process.env): OutputBudget {
  const positiveInt = (raw: string | undefined, fallback: number): number => {
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
  }
  return {
    maxStepOutputBytes: positiveInt(sourceEnv.FLOWSCRIPT_MAX_STEP_OUTPUT_BYTES, 1_048_576),
    maxRunOutputBytes: positiveInt(sourceEnv.FLOWSCRIPT_MAX_RUN_OUTPUT_BYTES, 16 * 1_048_576),
    maxOutputDepth: positiveInt(sourceEnv.FLOWSCRIPT_MAX_OUTPUT_DEPTH, 64),
  }
}

type SizeEstimate =
  | { ok: true; bytes: number }
  | { ok: false; reason: 'bytes' | 'depth'; depth?: number; limit: number }

/**
 * Iterative serialized-size estimate with an early abort, so a pathological
 * value can never be fully walked: the loop stops at the first frame that
 * pushes the cumulative estimate over `maxBytes`, or at a container nested
 * deeper than `maxDepth` (which also terminates self-referential structures
 * without a visited-set). Never recursive on purpose — it must survive the
 * exact payloads that overflow the recursive consumers it guards.
 */
function estimateSerializedSize(value: unknown, maxDepth: number, maxBytes: number): SizeEstimate {
  let bytes = 0
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  while (stack.length > 0) {
    const frame = stack.pop()!
    const current = frame.value
    if (current === null || current === undefined) {
      bytes += 4
    } else if (typeof current === 'string') {
      bytes += 2 + Buffer.byteLength(current)
    } else if (typeof current === 'object') {
      if (frame.depth >= maxDepth) {
        return { ok: false, reason: 'depth', depth: frame.depth + 1, limit: maxDepth }
      }
      bytes += 2
      if (Array.isArray(current)) {
        for (let index = current.length - 1; index >= 0; index--) {
          stack.push({ value: current[index], depth: frame.depth + 1 })
        }
      } else {
        for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
          bytes += 4 + Buffer.byteLength(key)
          stack.push({ value: child, depth: frame.depth + 1 })
        }
      }
    } else {
      // numbers, booleans, bigints and exotic values
      bytes += 8
    }
    if (bytes > maxBytes) {
      return { ok: false, reason: 'bytes', limit: maxBytes }
    }
  }
  return { ok: true, bytes }
}

function outputBudgetError(violation: SizeEstimate & { ok: false }, scope: 'step' | 'run'): Error {
  if (violation.reason === 'depth') {
    return Object.assign(
      new Error(`[OUTPUT_NESTING_TOO_DEEP] Output nests ${violation.depth} levels deep, beyond the maximum of ${violation.limit} (FLOWSCRIPT_MAX_OUTPUT_DEPTH)`),
      { code: 'OUTPUT_NESTING_TOO_DEEP', retryable: false },
    )
  }
  if (scope === 'step') {
    return Object.assign(
      new Error(`[OUTPUT_TOO_LARGE] Step output exceeds the maximum serialized size of ${violation.limit} bytes (FLOWSCRIPT_MAX_STEP_OUTPUT_BYTES); refusing to buffer it`),
      { code: 'OUTPUT_TOO_LARGE', retryable: false },
    )
  }
  return Object.assign(
    new Error(`[RUN_OUTPUT_TOO_LARGE] Run output budget exceeded: cumulative step outputs reach ${violation.limit} bytes (FLOWSCRIPT_MAX_RUN_OUTPUT_BYTES)`),
    { code: 'RUN_OUTPUT_TOO_LARGE', retryable: false },
  )
}

export function topologicallySortSteps<T extends { id: string; dependsOn: string[] }>(steps: T[]): T[] {
  const byId = new Map<string, T>()
  const inDegree = new Map<string, number>()
  const graph = new Map<string, string[]>()

  for (const step of steps) {
    byId.set(step.id, step)
    inDegree.set(step.id, step.dependsOn.length)
    for (const dep of step.dependsOn) {
      const dependents = graph.get(dep) ?? []
      dependents.push(step.id)
      graph.set(dep, dependents)
    }
  }

  const queue: string[] = []
  for (const step of steps) {
    if ((inDegree.get(step.id) ?? 0) === 0) {
      queue.push(step.id)
    }
  }

  const sorted: T[] = []
  while (queue.length > 0) {
    const currentId = queue.shift()!
    const step = byId.get(currentId)
    if (step) {
      sorted.push(step)
    }
    const neighbors = graph.get(currentId) ?? []
    for (const neighborId of neighbors) {
      const updatedDegree = (inDegree.get(neighborId) ?? 1) - 1
      inDegree.set(neighborId, updatedDegree)
      if (updatedDegree === 0) {
        queue.push(neighborId)
      }
    }
  }

  if (sorted.length !== steps.length) {
    return steps
  }

  return sorted
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function executeFlowIR(
  ir: FlowIR,
  options: {
    input?: Record<string, unknown>
    trigger?: Record<string, unknown>
    env?: Record<string, string | undefined>
    integrationExecutor?: IntegrationExecutor | FlowIntegrationExecutor
    projectId?: string
    platformId?: string
    runId?: string
    maxSteps?: number
    stepTimeoutMs?: number
    maxStepAttempts?: number
    maxStepOutputBytes?: number
    maxRunOutputBytes?: number
    maxOutputDepth?: number
    signal?: AbortSignal
    onStepAttemptStart?: (stepId: string, attempt: number) => Promise<string | void>
    onStepAttemptFinish?: (
      attemptId: string | void,
      details: { status: 'succeeded' | 'failed'; errorCode?: string; errorMessage?: string; retryable?: boolean; durationMs: number },
    ) => Promise<void>
    onNonIdempotentStep?: (stepId: string) => Promise<void>
  } = {},
): Promise<RunResult> {
  const input = options.input ?? {}
  const trigger = options.trigger ?? {}
  const outputs: Record<string, unknown> = {}
  const steps: RunResult['steps'] = []
  const completed = new Set<string>()
  const maxSteps = options.maxSteps ?? 200
  const timeoutMs = options.stepTimeoutMs ?? 30_000
  const maxStepAttempts = Math.max(1, options.maxStepAttempts ?? 3)
  const defaultBudget = resolveOutputBudget()
  const budget = {
    maxStepOutputBytes: options.maxStepOutputBytes ?? defaultBudget.maxStepOutputBytes,
    maxRunOutputBytes: options.maxRunOutputBytes ?? defaultBudget.maxRunOutputBytes,
    maxOutputDepth: options.maxOutputDepth ?? defaultBudget.maxOutputDepth,
  }
  let cumulativeStepOutputBytes = 0
  if (ir.steps.length > maxSteps) throw new Error(`Flow exceeds maximum step count (${maxSteps})`)
  const context = (): StepContext => ({ input, trigger, outputs, env: options.env ?? {} })

  const orderedSteps = topologicallySortSteps(ir.steps)
  for (const step of orderedSteps) {
    if (options.signal?.aborted) {
      return { status: 'cancelled', cancelled: true, error: 'Execution cancelled', steps }
    }

    if (!step.dependsOn.every(id => completed.has(id))) {
      return { status: 'failed', steps: [...steps, { id: step.id, status: 'failed', error: 'Dependency was not completed before this step', durationMs: 0 }] }
    }

    const stepStart = Date.now()
    const isIntegration = step.kind === 'integration'
    const allowedAttempts = isIntegration ? maxStepAttempts : 1
    let attempt = 0
    let stepSuccess = false
    let stepOutput: unknown
    let lastError: unknown = null
    let lastErrorCode: string | undefined
    let lastRetryable = false

    while (attempt < allowedAttempts && !stepSuccess) {
      attempt++
      if (options.signal?.aborted) {
        return { status: 'cancelled', cancelled: true, error: 'Execution cancelled', steps }
      }

      const attemptStart = Date.now()
      let attemptId: string | void = undefined
      if (options.onStepAttemptStart) {
        attemptId = await options.onStepAttemptStart(step.id, attempt)
      }

      try {
        const config = resolveValue(step.config, context()) as Record<string, unknown>

        if (step.kind === 'integration') {
          if (!options.integrationExecutor) throw new Error('No trusted integration executor is configured; refusing to execute integration step')

          // If the step does not specify an idempotency key, it represents an ambiguous/non-idempotent side effect
          if (!config.idempotencyKey && options.onNonIdempotentStep) {
            await options.onNonIdempotentStep(step.id)
          }

          let timer: ReturnType<typeof setTimeout> | undefined
          try {
            const executor = options.integrationExecutor
            let executionPromise: Promise<unknown>

            if (typeof executor === 'object' && executor !== null && 'execute' in executor) {
              const integrationName = String(config.integration ?? config.pieceName ?? config.integrationName ?? '')
              const actionName = String(config.action ?? config.tool ?? config.actionName ?? '')
              const connectionId = String(config.connectionId ?? '')
              const actionInput = (config.input && typeof config.input === 'object' ? config.input : {}) as Record<string, unknown>

              executionPromise = (executor as FlowIntegrationExecutor).execute({
                projectId: options.projectId ?? 'default-project',
                platformId: options.platformId ?? 'default-platform',
                integrationName,
                actionName,
                connectionId,
                input: actionInput,
                runId: options.runId ?? 'local-run',
                stepId: step.id,
                idempotencyKey: config.idempotencyKey ? String(config.idempotencyKey) : undefined,
              })
            } else {
              executionPromise = (executor as IntegrationExecutor)(config, context())
            }

            stepOutput = await Promise.race([
              executionPromise,
              new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Step timed out after ${timeoutMs}ms`)), timeoutMs) }),
            ])
          } finally {
            if (timer) clearTimeout(timer)
          }
        } else if (step.kind === 'transform') {
          stepOutput = config.value === undefined ? config : resolveValue(config.value, context())
        } else {
          stepOutput = config.when === true
        }

        // Bound the output BEFORE the redaction clone materializes it: resolveValue
        // returns shared references, so an amplifying config is cheap to build but
        // exponentially expensive to clone, stringify and persist.
        const stepSize = estimateSerializedSize(stepOutput, budget.maxOutputDepth, budget.maxStepOutputBytes)
        if (!stepSize.ok) {
          throw outputBudgetError(stepSize, 'step')
        }
        cumulativeStepOutputBytes += stepSize.bytes
        if (cumulativeStepOutputBytes > budget.maxRunOutputBytes) {
          throw outputBudgetError({ ok: false, reason: 'bytes', limit: budget.maxRunOutputBytes }, 'run')
        }

        const sanitizedOutput = redactSensitiveData(stepOutput)
        stepSuccess = true
        outputs[step.id] = sanitizedOutput
        completed.add(step.id)

        if (options.onStepAttemptFinish) {
          await options.onStepAttemptFinish(attemptId, {
            status: 'succeeded',
            durationMs: Date.now() - attemptStart,
          })
        }

        steps.push({
          id: step.id,
          status: 'succeeded',
          output: sanitizedOutput,
          durationMs: Date.now() - stepStart,
          attempts: attempt,
        })
      } catch (error) {
        lastError = error
        const duration = Date.now() - attemptStart
        const rawMessage = error instanceof Error ? error.message : 'Unknown step error'
        const sanitizedError = redactSensitiveData(rawMessage) as string

        if (error instanceof FlowIntegrationError) {
          lastErrorCode = error.code
          lastRetryable = error.details?.retryable ?? (error as any).retryable ?? false
        } else if (error && typeof error === 'object' && 'retryable' in error && typeof (error as any).retryable === 'boolean') {
          lastRetryable = (error as any).retryable
          lastErrorCode = (error as any).code ?? 'TRANSIENT_ERROR'
        } else if (rawMessage.includes('timed out')) {
          lastRetryable = true
          lastErrorCode = 'TIMEOUT'
        } else {
          lastRetryable = false
          lastErrorCode = 'UNCLASSIFIED'
        }

        if (options.onStepAttemptFinish) {
          await options.onStepAttemptFinish(attemptId, {
            status: 'failed',
            errorCode: lastErrorCode,
            errorMessage: sanitizedError,
            retryable: lastRetryable,
            durationMs: duration,
          })
        }

        if (lastRetryable && attempt < allowedAttempts && !options.signal?.aborted) {
          const backoff = computeBackoff(attempt, 20, 500)
          await sleep(backoff)
          continue
        } else {
          break
        }
      }
    }

    if (!stepSuccess) {
      const rawMessage = lastError instanceof Error ? lastError.message : 'Unknown step error'
      const sanitizedError = redactSensitiveData(rawMessage) as string
      steps.push({
        id: step.id,
        status: 'failed',
        error: sanitizedError,
        durationMs: Date.now() - stepStart,
        attempts: attempt,
      })
      return { status: 'failed', steps, error: sanitizedError }
    }
  }

  if (options.signal?.aborted) {
    return { status: 'cancelled', cancelled: true, error: 'Execution cancelled', steps }
  }

  try {
    const finalOutput = ir.output ? resolveValue(ir.output, context()) : outputs
    const finalSize = estimateSerializedSize(finalOutput, budget.maxOutputDepth, budget.maxRunOutputBytes)
    if (!finalSize.ok) {
      throw outputBudgetError(finalSize, 'run')
    }
    return { status: 'succeeded', output: redactSensitiveData(finalOutput), steps }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Output resolution failed'
    const sanitizedError = redactSensitiveData(message) as string
    return { status: 'failed', steps, error: sanitizedError }
  }
}
