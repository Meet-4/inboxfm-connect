import { describe, expect, it } from 'vitest'
import { executeFlowIR } from './runtime.js'
import type { FlowIR } from './compiler.js'

/**
 * Step-attempt bookkeeping is an audit trail, not part of the step's contract.
 *
 * `onStepAttemptFinish` runs after the step body has already produced its result
 * (and, for integration steps, after the external side effect happened). Because
 * the callback was awaited inside the step's own try/catch, a failed record write
 * (DB hiccup, pool exhaustion) was treated as a step failure: the completed step's
 * output was discarded, the run was reported as failed, and retryable integration
 * steps could be executed a second time. These tests pin the corrected behaviour.
 */
describe('executeFlowIR step-attempt recording failures', () => {
  const transformFlow = {
    irVersion: 1 as const,
    name: 'transform-flow',
    version: 1,
    trigger: { kind: 'manual' as const },
    inputSchema: {},
    steps: [
      { id: 'first', kind: 'transform' as const, config: { value: { ok: true } }, dependsOn: [] },
      { id: 'second', kind: 'transform' as const, config: { $ref: 'steps.first' } as unknown as Record<string, unknown>, dependsOn: ['first'] },
    ],
  } as unknown as FlowIR

  it('keeps a completed step successful when persisting its attempt record fails', async () => {
    const attempted: Array<{ attemptId: string | void; status: string }> = []

    const result = await executeFlowIR(transformFlow, {
      onStepAttemptStart: async () => 'attempt-1',
      onStepAttemptFinish: async (attemptId, details) => {
        attempted.push({ attemptId, status: details.status })
        throw new Error('connection terminated unexpectedly')
      },
    })

    expect(result.status).toBe('succeeded')
    expect(result.error).toBeUndefined()
    expect(result.steps).toHaveLength(2)
    expect(result.steps.every(step => step.status === 'succeeded')).toBe(true)
    expect(result.output).toEqual({ first: { ok: true }, second: { ok: true } })
    // The audit callback was still invoked for every step.
    expect(attempted).toHaveLength(2)
    expect(attempted.every(entry => entry.status === 'succeeded')).toBe(true)
  })

  it('does not retry an integration side effect when only the attempt record write failed', async () => {
    let executions = 0
    const flow = {
      irVersion: 1 as const,
      name: 'side-effect-flow',
      version: 1,
      trigger: { kind: 'manual' as const },
      inputSchema: {},
      steps: [{
        id: 'send',
        kind: 'integration' as const,
        config: { integration: 'sendgrid', action: 'send_mail', connectionId: 'conn-1', idempotencyKey: 'key-1' },
        dependsOn: [],
      }],
    } as unknown as FlowIR

    const result = await executeFlowIR(flow, {
      integrationExecutor: {
        execute: async () => {
          executions++
          return { messageId: 'msg-1' }
        },
      },
      onStepAttemptStart: async () => 'attempt-send',
      onStepAttemptFinish: async () => {
        throw new Error('deadlock detected')
      },
    })

    expect(executions).toBe(1)
    expect(result.status).toBe('succeeded')
    expect(result.steps[0].attempts).toBe(1)
    expect(result.steps[0].output).toEqual({ messageId: 'msg-1' })
  })

  it('reports the step error, not the bookkeeping error, when both a step and its attempt record fail', async () => {
    const flow = {
      irVersion: 1 as const,
      name: 'failing-step-flow',
      version: 1,
      trigger: { kind: 'manual' as const },
      inputSchema: {},
      steps: [{
        id: 'boom',
        kind: 'integration' as const,
        config: { integration: 'gmail', action: 'search', connectionId: 'conn-2', idempotencyKey: 'key-2' },
        dependsOn: [],
      }],
    } as unknown as FlowIR

    const result = await executeFlowIR(flow, {
      integrationExecutor: {
        execute: async () => {
          throw Object.assign(new Error('provider rejected the request'), { retryable: false })
        },
      },
      onStepAttemptStart: async () => 'attempt-boom',
      onStepAttemptFinish: async () => {
        throw new Error('could not serialize access due to concurrent update')
      },
    })

    expect(result.status).toBe('failed')
    expect(result.error).toBe('provider rejected the request')
    expect(result.steps[0].status).toBe('failed')
    expect(JSON.stringify(result)).not.toContain('could not serialize access')
  })

  it('still surfaces a genuine step failure when the record write succeeds', async () => {
    const flow = {
      irVersion: 1 as const,
      name: 'plain-failure',
      version: 1,
      trigger: { kind: 'manual' as const },
      inputSchema: {},
      steps: [{ id: 'only', kind: 'filter' as const, config: { when: false }, dependsOn: [] }],
    } as unknown as FlowIR

    const result = await executeFlowIR(flow, {
      onStepAttemptStart: async () => 'attempt-only',
      onStepAttemptFinish: async () => {},
    })

    expect(result.status).toBe('succeeded')
    expect(result.steps[0].output).toBe(false)
  })
})
