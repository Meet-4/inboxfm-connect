import { formulaEvaluator } from '@inboxfm-connect/core-formula'
import { describe, expect, it } from 'vitest'

const result = (expr: string, data: Record<string, unknown> = {}) =>
    formulaEvaluator.evaluate({ expression: formulaEvaluator.wrap(expr), sampleData: data }).result

// 2024-01-15T12:00:00Z — midday, so every UTC offset lands on the same calendar
// day and the assertions stay timezone independent.
const TS = 1705320000000

// Webhook payloads and table date columns arrive as epoch milliseconds, and a
// formula arg is a number whenever the value comes from a variable. The date
// functions stringified every input (`dayjs(String(d))`), and dayjs parses the
// 13 digits of "1705316400000" as a year: 1705316400000-01-01 rolls over into
// 1707, so every epoch timestamp formatted as a date in the year 1707.
describe('date functions: epoch millisecond input', () => {
    it('format_date formats an epoch-ms variable as the real date', () => {
        expect(result('format_date({{ts}}; "YYYY-MM-DD")', { ts: TS })).toBe('2024-01-15')
    })

    it('format_time reads the time from an epoch-ms variable', () => {
        expect(result('format_time({{ts}}; "YYYY-MM-DD")', { ts: TS })).toBe('2024-01-15')
    })

    it('to_date returns the exact ISO instant', () => {
        expect(result('to_date({{ts}})', { ts: TS })).toBe('2024-01-15T12:00:00.000Z')
    })

    it('get_year / get_day read the epoch-ms date', () => {
        expect(result('get_year({{ts}})', { ts: TS })).toBe(2024)
        expect(result('get_day({{ts}})', { ts: TS })).toBe(15)
    })

    it('comparisons work on epoch-ms input', () => {
        expect(result('is_after({{ts}}; "2024-01-01")', { ts: TS })).toBe(true)
        expect(result('days_between({{ts}}; "2024-01-01T12:00:00Z")', { ts: TS })).toBe(14)
    })

    it('a bare epoch-ms literal is a date, not a year', () => {
        // The implicit-quoting pass hands a bare numeric literal to a date slot
        // as text, so the digits arrive as a string.
        expect(result('format_date(1705320000000; "YYYY-MM-DD")')).toBe('2024-01-15')
        expect(result('to_date("1705320000000")')).toBe('2024-01-15T12:00:00.000Z')
    })

    it('zero is a valid instant, not an empty value', () => {
        expect(result('to_date({{ts}})', { ts: 0 })).toBe('1970-01-01T00:00:00.000Z')
    })
})

describe('date functions: plain date input is untouched', () => {
    it('keeps ISO date strings', () => {
        expect(result('format_date("2024-01-15"; "YYYY-MM-DD")')).toBe('2024-01-15')
        expect(result('to_date("2024-01-15T12:00:00Z")')).toBe('2024-01-15T12:00:00.000Z')
    })

    it('keeps a four digit year string a year', () => {
        expect(result('get_year("2025")')).toBe(2025)
        expect(result('format_date("2025"; "YYYY")')).toBe('2025')
    })

    it('keeps human readable dates', () => {
        expect(result('format_date("January 15, 2025"; "YYYY-MM-DD")')).toBe('2025-01-15')
    })

    it('still returns empty for unusable input', () => {
        expect(result('format_date("not a date"; "YYYY-MM-DD")')).toBe('')
        expect(result('to_date("not a date")')).toBe('')
        expect(result('add_days("not a date"; 1)')).toBe('')
    })

    it('keeps Date instances working', () => {
        expect(result('to_date({{d}})', { d: new Date('2024-01-15T12:00:00Z') })).toBe('2024-01-15T12:00:00.000Z')
    })
})
