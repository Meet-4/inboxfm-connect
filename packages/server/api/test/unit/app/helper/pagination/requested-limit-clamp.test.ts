import { describe, expect, it } from 'vitest'

// A user-supplied `limit` of -1 must never reach the paginator: it aliases the
// Paginator.NO_LIMIT sentinel (full-table dump, no SQL LIMIT), and a huge value
// becomes an unbounded `take(limit + 1)`. Routes that pass raw query limits
// through buildPaginator clamp them with clampRequestedLimit first.

import Paginator from '../../../../../src/app/helper/pagination/paginator'
import { clampRequestedLimit } from '../../../../../src/app/helper/pagination/pagination-utils'

describe('clampRequestedLimit', () => {
    it('returns the fallback for nil or non-finite input', () => {
        expect(clampRequestedLimit(undefined, 10)).toBe(10)
        expect(clampRequestedLimit(null, 10)).toBe(10)
        expect(clampRequestedLimit(Number.NaN, 10)).toBe(10)
        expect(clampRequestedLimit(Number.POSITIVE_INFINITY, 10)).toBe(10)
    })

    it('clamps -1 (the NO_LIMIT sentinel) back to 1, not unlimited', () => {
        expect(clampRequestedLimit(-1, 10)).toBe(1)
        expect(clampRequestedLimit(-1, 10)).not.toBe(Paginator.NO_LIMIT)
    })

    it('clamps out-of-range values into [1, 100]', () => {
        expect(clampRequestedLimit(-100, 10)).toBe(1)
        expect(clampRequestedLimit(0, 10)).toBe(1)
        expect(clampRequestedLimit(1, 10)).toBe(1)
        expect(clampRequestedLimit(50, 10)).toBe(50)
        expect(clampRequestedLimit(100, 10)).toBe(100)
        expect(clampRequestedLimit(1000000, 10)).toBe(100)
    })

    it('truncates fractional input to an integer', () => {
        expect(clampRequestedLimit(10.9, 20)).toBe(10)
        expect(clampRequestedLimit(0.4, 20)).toBe(1)
    })
})
