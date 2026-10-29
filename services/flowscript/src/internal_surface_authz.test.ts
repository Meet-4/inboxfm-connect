import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { anonymousInternalEndpointsAllowed, buildServer, signProjectId } from './server.js'

const source = readFileSync(new URL('../examples/manual.flow', import.meta.url), 'utf8')

const flow = {
  irVersion: 1,
  name: 'env-probe',
  version: 1,
  trigger: { kind: 'manual' },
  inputSchema: {},
  steps: [
    {
      id: 'read_env',
      kind: 'transform',
      config: { value: { captured: { $env: 'INTERNAL_ONLY_TEST' } } },
      dependsOn: [],
    },
  ],
  output: { captured: { $ref: 'steps.read_env.captured' } },
}

const sign = (projectId: string) => ({ 'x-project-id': projectId, 'x-project-signature': signProjectId(projectId) })

describe('internal-only endpoints require verified project identity', () => {
  const app = buildServer()

  it('rejects anonymous /v1/source/compile', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/source/compile', payload: { source } })
    expect(res.statusCode).toBe(401)
    expect(res.json().code).toBe('MISSING_PROJECT_IDENTITY')
  })

  it('rejects anonymous /v1/ir/validate', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/ir/validate', payload: flow })
    expect(res.statusCode).toBe(401)
  })

  it('rejects anonymous /v1/ir/execute-local and never resolves FLOWSCRIPT_ENV_ values', async () => {
    process.env.FLOWSCRIPT_ENV_INTERNAL_ONLY_TEST = 'must_not_leak'
    try {
      const res = await app.inject({ method: 'POST', url: '/v1/ir/execute-local', payload: { flow } })
      expect(res.statusCode).toBe(401)
      // The server enforces the gateway secret in tests, so a forged signature must fail closed too.
      const forged = await app.inject({
        method: 'POST',
        url: '/v1/ir/execute-local',
        headers: { 'x-project-id': 'proj_alpha', 'x-project-signature': 'f'.repeat(64) },
        payload: { flow },
      })
      expect(forged.statusCode).toBe(401)
      expect(forged.body).not.toContain('must_not_leak')

      // A verified caller still gets the documented behaviour.
      const signed = await app.inject({ method: 'POST', url: '/v1/ir/execute-local', headers: sign('proj_alpha'), payload: { flow } })
      expect(signed.statusCode).toBe(200)
      expect(signed.json().output.captured).toBe('must_not_leak')
    } finally {
      delete process.env.FLOWSCRIPT_ENV_INTERNAL_ONLY_TEST
    }
  })

  it('keeps the documented behaviour for verified callers', async () => {
    const compile = await app.inject({ method: 'POST', url: '/v1/source/compile', headers: sign('proj_alpha'), payload: { source } })
    expect(compile.statusCode).toBe(200)
    expect(compile.json().valid).toBe(true)

    const validate = await app.inject({ method: 'POST', url: '/v1/ir/validate', headers: sign('proj_alpha'), payload: flow })
    expect(validate.statusCode).toBe(200)
    expect(validate.json().valid).toBe(true)
  })

  it('honours the non-production opt-in for local tooling', async () => {
    process.env.FLOWSCRIPT_ALLOW_UNAUTHENTICATED_DEV = 'true'
    try {
      const res = await app.inject({ method: 'POST', url: '/v1/ir/validate', payload: flow })
      expect(res.statusCode).toBe(200)
    } finally {
      delete process.env.FLOWSCRIPT_ALLOW_UNAUTHENTICATED_DEV
    }
  })
})

describe('anonymousInternalEndpointsAllowed', () => {
  it('defaults to denying anonymous access', () => {
    expect(anonymousInternalEndpointsAllowed({})).toBe(false)
    expect(anonymousInternalEndpointsAllowed({ NODE_ENV: 'development' })).toBe(false)
    expect(anonymousInternalEndpointsAllowed({ FLOWSCRIPT_ALLOW_UNAUTHENTICATED_DEV: 'false' })).toBe(false)
  })

  it('allows the opt-in outside production only', () => {
    expect(anonymousInternalEndpointsAllowed({ NODE_ENV: 'development', FLOWSCRIPT_ALLOW_UNAUTHENTICATED_DEV: '1' })).toBe(true)
    expect(anonymousInternalEndpointsAllowed({ NODE_ENV: 'test', FLOWSCRIPT_ALLOW_UNAUTHENTICATED_DEV: ' TRUE ' })).toBe(true)
    // The escape hatch can never be enabled in production, even with the flag set.
    expect(anonymousInternalEndpointsAllowed({ NODE_ENV: 'production', FLOWSCRIPT_ALLOW_UNAUTHENTICATED_DEV: 'true' })).toBe(false)
  })
})
