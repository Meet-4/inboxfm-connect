import { formulaEvaluator } from '@inboxfm-connect/core-formula'
import { describe, expect, it } from 'vitest'

const result = (expr: string, data: Record<string, unknown> = {}) =>
    formulaEvaluator.evaluate({ expression: formulaEvaluator.wrap(expr), sampleData: data }).result

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

// Every text function sliced the raw UTF-16 string, so anything outside the BMP
// (emoji, most CJK extensions, ...) was counted twice and could be cut in half:
// length("😀") was 2, first_n("😀abc"; 1) returned the lone high surrogate
// "\ud83d" — a string that cannot be encoded and shows as a replacement
// character downstream (sanitizeObjectForPostgresql exists precisely to strip
// such halves before they reach the database).
describe('text functions: characters, not UTF-16 code units', () => {
    it('length counts an emoji as one character', () => {
        expect(result('length("😀")')).toBe(1)
        expect(result('length("a😀b")')).toBe(3)
        expect(result('length("😀😀😀")')).toBe(3)
    })

    it('length keeps plain text unchanged', () => {
        expect(result('length("hello")')).toBe(5)
        expect(result('length("héllo")')).toBe(5)
        expect(result('length("")')).toBe(0)
    })

    it('first_n never splits a surrogate pair', () => {
        expect(result('first_n("😀abc"; 1)')).toBe('😀')
        expect(result('first_n("😀😀"; 2)')).toBe('😀😀')
        expect(result('first_n("a😀b"; 2)')).toBe('a😀')
    })

    it('first_n keeps plain text unchanged', () => {
        expect(result('first_n("hello"; 3)')).toBe('hel')
        expect(result('first_n("hello"; 99)')).toBe('hello')
        expect(result('first_n("hello"; 0)')).toBe('')
    })

    it('last_n never splits a surrogate pair', () => {
        expect(result('last_n("abc😀"; 1)')).toBe('😀')
        expect(result('last_n("😀ab"; 2)')).toBe('ab')
        expect(result('last_n("ACC-7890"; 4)')).toBe('7890')
    })

    it('truncate cuts on a character boundary', () => {
        expect(result('truncate("😀😀😀"; 2)')).toBe('😀😀...')
        expect(result('truncate("😀😀"; 1)')).toBe('😀...')
        expect(result('truncate("hello world"; 5)')).toBe('hello...')
        expect(result('truncate("hi"; 10)')).toBe('hi')
    })

    it('no text function returns a lone surrogate', () => {
        for (const expression of ['first_n("😀abc"; 1)', 'last_n("abc😀"; 1)', 'truncate("😀😀"; 1)']) {
            const value = result(expression) as string
            expect(LONE_SURROGATE.test(value)).toBe(false)
        }
    })

    it('length still counts list items, not characters', () => {
        expect(result('length({{l}})', { l: ['a', 'b', 'c'] })).toBe(3)
        expect(result('length({{l}})', { l: [] })).toBe(0)
    })

    it('reverse already handled surrogate pairs and still does', () => {
        expect(result('reverse("😀ab")')).toBe('ba😀')
    })

    it('counts code points, not grapheme clusters (documented limitation)', () => {
        // A family emoji is 5 code points joined by ZWJ. Full grapheme
        // segmentation would need Intl.Segmenter and would change length() for
        // combining accents too, so the fix stops at code points.
        expect(result('length("👨‍👩‍👧")')).toBe(5)
    })
})
