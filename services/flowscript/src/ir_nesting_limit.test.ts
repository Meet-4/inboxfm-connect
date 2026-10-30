import { describe, expect, it } from 'vitest'
import { MAX_IR_NESTING_DEPTH, buildServer, findIrNestingViolation, validateFlowIR } from './server.js'

type Json = unknown

/** Builds `depth` nested single-key objects without recursing. */
function nestObjects(depth: number, leaf: Json = 'value'): Json {
  let value: Json = leaf
  for (let index = 0; index < depth; index++) value = { nested: value }
  return value
}

/** Builds `depth` nested single-element arrays without recursing. */
function nestArrays(depth: number, leaf: Json = 'value'): Json {
  let value: Json = leaf
  for (let index = 0; index < depth; index++) value = [value]
  return value
}

function nestedArraysJson(depth: number): string {
  return '['.repeat(depth) + '1' + ']'.repeat(depth)
}

function irWithValue(value: Json) {
  return {
    irVersion: 1 as const,
    name: 'nesting-flow',
    version: 1,
    trigger: { kind: 'manual' as const },
    inputSchema: {},
    steps: [{ id: 'shape', kind: 'transform' as const, config: { value }, dependsOn: [] }],
  }
}

describe('FlowScript IR import rejects absurd nesting instead of overflowing the stack', () => {
  it('accepts nesting that realistic flows use', () => {
    // flow(0) -> steps(1) -> step(2) -> config(3) -> value(4) + 20 nested containers
    const result = validateFlowIR(irWithValue(nestObjects(20)))
    expect(result.valid).toBe(true)
  })

  it('rejects nesting beyond the documented maximum with an addressed diagnostic', () => {
    const result = validateFlowIR(irWithValue(nestObjects(MAX_IR_NESTING_DEPTH)))

    expect(result.valid).toBe(false)
    if (result.valid) throw new Error('unreachable')
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].path).toMatch(/^steps\.0\.config\.value(\.nested)+$/)
    expect(result.issues[0].message).toContain(`maximum of ${MAX_IR_NESTING_DEPTH}`)
  })

  it('measures depth iteratively so the guard survives payloads that break recursive walkers', () => {
    // 50k containers: any recursive traversal (JSON.stringify, resolveValue,
    // the Zod echo path) dies here, the guard must not.
    const violation = findIrNestingViolation(nestArrays(50_000), MAX_IR_NESTING_DEPTH)
    expect(violation).not.toBeNull()
    expect(violation?.message).toContain('exceeds the maximum')
  })

  it('answers POST /v1/ir/validate with 400 instead of a 500 stack overflow', async () => {
    const app = buildServer()
    try {
      // 8k nested arrays = 16 KB body; before the fix this returned HTTP 500
      // "Maximum call stack size exceeded" while serialising the echoed flow.
      const body = JSON.stringify(irWithValue('__NESTED__')).replace('"__NESTED__"', nestedArraysJson(8_000))
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ir/validate',
        headers: { 'content-type': 'application/json' },
        payload: body,
      })

      expect(response.statusCode).toBe(400)
      const payload = response.json()
      expect(payload.code).toBe('BAD_REQUEST')
      expect(payload.issues?.[0]?.message ?? payload.details?.issues?.[0]?.message).toContain('Nesting depth')
      expect(response.body).not.toContain('Maximum call stack size exceeded')
    } finally {
      await app.close()
    }
  })

  it('answers POST /v1/ir/execute-local with a validation error, not a stack-overflow step failure', async () => {
    const app = buildServer()
    try {
      const flow = JSON.stringify(irWithValue('__NESTED__')).replace('"__NESTED__"', nestedArraysJson(8_000))
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ir/execute-local',
        headers: { 'content-type': 'application/json' },
        payload: `{"flow":${flow},"input":{}}`,
      })

      expect(response.statusCode).toBe(422)
      expect(response.body).not.toContain('Maximum call stack size exceeded')
      expect(response.json().issues?.[0]?.message ?? response.json().details?.issues?.[0]?.message).toContain('Nesting depth')
    } finally {
      await app.close()
    }
  })
})
