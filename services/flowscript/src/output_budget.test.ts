import { describe, expect, it } from 'vitest'
import { executeFlowIR, resolveOutputBudget } from './runtime.js'
import type { FlowIR } from './compiler.js'

/**
 * The IR executor resolved step outputs with no size or depth accounting.
 * resolveValue returns shared references, but redactSensitiveData and the
 * JSON.stringify in finishRun both materialize the full expansion, so a tiny
 * flow whose steps reference earlier outputs k times per step expands
 * exponentially: measured pre-fix, a 6-step flow (100KB base, 8 refs/step)
 * ran 43 seconds, allocated gigabytes, and produced a steps blob that
 * JSON.stringify refused to serialize at all ("Invalid string length").
 * The same path runs in /v1/ir/execute-local, so a handful of requests
 * exhaust the process.
 *
 * These tests pin the bounded behaviour: outputs past the per-step /
 * per-run byte budgets or the depth limit fail fast, non-retryably, with
 * an actionable code; legitimate flows are unaffected.
 */
describe('FlowScript IR executor output budgets', () => {
  const KB = 1024
  const MB = 1024 * 1024

  const makeIr = (steps: Array<Record<string, unknown>>): FlowIR =>
    ({ irVersion: 1, name: 'budget-flow', version: 1, trigger: { kind: 'manual' }, inputSchema: {}, steps } as unknown as FlowIR)

  const refConfig = (dep: string, n: number) => {
    const value: Record<string, unknown> = {}
    for (let i = 0; i < n; i++) value[`r${i}`] = { $ref: `steps.${dep}` }
    return { value }
  }

  it('fails fast when step references amplify previous outputs past the byte budget', async () => {
    const steps = [
      { id: 's0', kind: 'transform', config: { value: Array.from({ length: 100 }, () => 'x'.repeat(256)) }, dependsOn: [] },
      { id: 's1', kind: 'transform', config: refConfig('s0', 8), dependsOn: ['s0'] },
      { id: 's2', kind: 'transform', config: refConfig('s1', 8), dependsOn: ['s1'] },
      { id: 's3', kind: 'transform', config: refConfig('s2', 8), dependsOn: ['s2'] }, // 100KB * 8^3 = ~51MB if unbounded
      { id: 's4', kind: 'transform', config: refConfig('s3', 8), dependsOn: ['s3'] },  // ~412MB if unbounded
    ]
    const t0 = Date.now()
    const result = await executeFlowIR(makeIr(steps), { input: {}, trigger: {} })
    const elapsed = Date.now() - t0

    expect(result.status).toBe('failed')
    expect(result.error).toContain('OUTPUT_TOO_LARGE')
    expect(elapsed).toBeLessThan(5_000)
    // s0 = 100x256B; s1 = 8 refs (205KB); s2 = 8 refs (1.6MB) trips the 1MB step budget.
    // Earlier steps still executed and are audited; s3/s4 (8^3 and 8^4 = 51MB/412MB
    // pre-fix) never materialize.
    expect(result.steps.filter(s => s.status === 'succeeded').length).toBeGreaterThanOrEqual(2)
  })

  it('rejects a single oversized step output (width bomb)', async () => {
    const steps = [
      { id: 'big', kind: 'transform', config: { value: 'y'.repeat(2 * MB + 1) }, dependsOn: [] },
    ]
    const result = await executeFlowIR(makeIr(steps), { input: {}, trigger: {} })

    expect(result.status).toBe('failed')
    expect(result.error).toContain('OUTPUT_TOO_LARGE')
  })

  it('rejects outputs nested deeper than the depth limit', async () => {
    let deep: unknown = 'leaf'
    for (let i = 0; i < 100; i++) deep = [deep]
    const steps = [
      { id: 'deep', kind: 'transform', config: { value: deep }, dependsOn: [] },
    ]
    const result = await executeFlowIR(makeIr(steps), { input: {}, trigger: {} })

    expect(result.status).toBe('failed')
    expect(result.error).toContain('OUTPUT_NESTING_TOO_DEEP')
  })

  it('enforces the cumulative run output budget across steps', async () => {
    const steps = [
      { id: 'a', kind: 'transform', config: { value: 'z'.repeat(500 * KB) }, dependsOn: [] },
      { id: 'b', kind: 'transform', config: { value: 'z'.repeat(500 * KB) }, dependsOn: [] },
      { id: 'c', kind: 'transform', config: { value: 'z'.repeat(500 * KB) }, dependsOn: [] },
    ]
    const result = await executeFlowIR(makeIr(steps), { input: {}, trigger: {}, maxRunOutputBytes: MB })

    expect(result.status).toBe('failed')
    expect(result.error).toContain('RUN_OUTPUT_TOO_LARGE')
    expect(result.steps.filter(s => s.status === 'succeeded')).toHaveLength(2)
  })

  it('rejects an oversized explicit flow output map', async () => {
    const steps = [
      { id: 's0', kind: 'transform', config: { value: 'ok' }, dependsOn: [] },
    ]
    const ir = {
      ...makeIr(steps),
      output: { value: { $ref: 'steps.s0' }, pad: 'p'.repeat(17 * MB) },
    } as unknown as FlowIR
    const result = await executeFlowIR(ir, { input: {}, trigger: {} })

    expect(result.status).toBe('failed')
    expect(result.error).toContain('RUN_OUTPUT_TOO_LARGE')
  })

  it('budget violations of integration step outputs are not retried', async () => {
    let calls = 0
    const executor = async () => {
      calls++
      return { blob: 'q'.repeat(2 * MB + 1) }
    }
    const steps = [
      { id: 'call', kind: 'integration', config: { integration: 'x', action: 'y' }, dependsOn: [] },
    ]
    const result = await executeFlowIR(makeIr(steps), { input: {}, trigger: {}, integrationExecutor: executor })

    expect(result.status).toBe('failed')
    expect(result.error).toContain('OUTPUT_TOO_LARGE')
    expect(calls).toBe(1)
  })

  it('legitimate flows are unaffected: refs between steps, deep-ish objects and modest sizes pass', async () => {
    let nested: unknown = { leaf: true }
    for (let i = 0; i < 10; i++) nested = { level: nested }
    const steps = [
      { id: 's0', kind: 'transform', config: { value: nested }, dependsOn: [] },
      { id: 's1', kind: 'transform', config: { value: { text: { $ref: 'steps.s0' }, direct: 'plain' } }, dependsOn: ['s0'] },
      { id: 's2', kind: 'transform', config: { value: 'w'.repeat(100 * KB) }, dependsOn: [] },
    ]
    const result = await executeFlowIR(makeIr(steps), { input: {}, trigger: {} })

    expect(result.status).toBe('succeeded')
    expect(result.steps).toHaveLength(3)
    expect(result.steps.every(s => s.status === 'succeeded')).toBe(true)
  })

  it('resolveOutputBudget reads env knobs safely and falls back on garbage', () => {
    expect(resolveOutputBudget({})).toEqual({
      maxStepOutputBytes: MB,
      maxRunOutputBytes: 16 * MB,
      maxOutputDepth: 64,
    })
    expect(resolveOutputBudget({
      FLOWSCRIPT_MAX_STEP_OUTPUT_BYTES: '2048',
      FLOWSCRIPT_MAX_RUN_OUTPUT_BYTES: '4096',
      FLOWSCRIPT_MAX_OUTPUT_DEPTH: '8',
    })).toEqual({ maxStepOutputBytes: 2048, maxRunOutputBytes: 4096, maxOutputDepth: 8 })
    expect(resolveOutputBudget({
      FLOWSCRIPT_MAX_STEP_OUTPUT_BYTES: 'not-a-number',
      FLOWSCRIPT_MAX_RUN_OUTPUT_BYTES: '-5',
      FLOWSCRIPT_MAX_OUTPUT_DEPTH: '',
    })).toEqual({
      maxStepOutputBytes: MB,
      maxRunOutputBytes: 16 * MB,
      maxOutputDepth: 64,
    })
  })
})
