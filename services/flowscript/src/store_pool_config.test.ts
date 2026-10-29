import { describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildPoolConfig, parsePoolMax } from './store.js'

describe('parsePoolMax', () => {
  it('defaults to 5 when unset or blank', () => {
    expect(parsePoolMax(undefined)).toBe(5)
    expect(parsePoolMax('')).toBe(5)
    expect(parsePoolMax('   ')).toBe(5)
  })

  it('accepts positive integers', () => {
    expect(parsePoolMax('1')).toBe(1)
    expect(parsePoolMax('12')).toBe(12)
    expect(parsePoolMax(' 25 ')).toBe(25)
  })

  it('falls back to the default on values pg would reject or silently ignore', () => {
    // pg coerces NaN/0 back to its own default of 10 and accepts negatives, which then never
    // hand out a client -- every query would hang on an unreachable pool.
    expect(parsePoolMax('abc')).toBe(5)
    expect(parsePoolMax('0')).toBe(5)
    expect(parsePoolMax('-1')).toBe(5)
    expect(parsePoolMax('2.5')).toBe(5)
    expect(parsePoolMax('1001')).toBe(5)
  })
})

describe('buildPoolConfig', () => {
  it('applies FLOWSCRIPT_DB_POOL_SIZE when DATABASE_URL is set', () => {
    const config = buildPoolConfig({ DATABASE_URL: 'postgres://u:p@db.internal:5432/app', FLOWSCRIPT_DB_POOL_SIZE: '3' })
    expect(config).toEqual({ connectionString: 'postgres://u:p@db.internal:5432/app', max: 3 })

    const pool = new pg.Pool(config)
    try {
      expect(pool.options.max).toBe(3)
    } finally {
      void pool.end()
    }
  })

  it('applies FLOWSCRIPT_DB_POOL_SIZE with discrete AP_POSTGRES_* settings', () => {
    const config = buildPoolConfig({ AP_POSTGRES_HOST: 'postgres', FLOWSCRIPT_DB_POOL_SIZE: '4' })
    expect(config.max).toBe(4)
    expect(config.host).toBe('postgres')
  })

  it('keeps the default when the variable is absent', () => {
    const pool = new pg.Pool(buildPoolConfig({ DATABASE_URL: 'postgres://u:p@db.internal:5432/app' }))
    try {
      // Before the fix this branch produced pg's default of 10 instead of the configured value.
      expect(pool.options.max).toBe(5)
    } finally {
      void pool.end()
    }
  })
})
