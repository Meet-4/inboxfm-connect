import { formulaEvaluator } from '@inboxfm-connect/core-formula'
import { describe, expect, it } from 'vitest'

const result = (expr: string, data: Record<string, unknown> = {}) =>
    formulaEvaluator.evaluate({ expression: formulaEvaluator.wrap(expr), sampleData: data }).result

const error = (expr: string, data: Record<string, unknown> = {}) =>
    formulaEvaluator.evaluate({ expression: formulaEvaluator.wrap(expr), sampleData: data }).error

// `{{field}}` is the documented way to reference a value. Text functions take
// that value inside a quoted string far more often than as a bare arg
// (`combine("Hi {{first_name}}"; "!")`), but the whole expression was
// substituted by regex before tokenizing, so a reference inside a string
// literal was replaced by the internal placeholder name and the formula
// returned the literal text `__ap_v0__` instead of the value.
describe('variable references inside string literals', () => {
    it('interpolates the value, not the internal placeholder', () => {
        expect(result('combine("Hello {{name}}"; "!")', { name: 'Ann' })).toBe('Hello Ann!')
    })

    it('interpolates at the start, middle and end of the literal', () => {
        expect(result('combine("{{a}}-{{b}}-{{a}}"; "")', { a: 'x', b: 'y' })).toBe('x-y-x')
    })

    it('interpolates inside a literal passed to a text predicate', () => {
        expect(result('contains({{msg}}; "Hi {{name}}")', { msg: 'Well, Hi Ann there', name: 'Ann' })).toBe(true)
        expect(error('contains({{msg}}; "Hi {{name}}")', { msg: 'Well, Hi Ann there', name: 'Ann' })).toBeNull()
    })

    it('keeps non-string values readable', () => {
        expect(result('combine("n={{n}}"; "")', { n: 5 })).toBe('n=5')
        expect(result('combine("on={{flag}}"; "")', { flag: true })).toBe('on=true')
    })

    it('drops a reference that has no value', () => {
        expect(result('combine("Hi {{missing}}"; "!")', {})).toBe('Hi !')
    })

    it('escapes quotes and backslashes so the literal stays parseable', () => {
        expect(result('combine("Hi {{q}}"; "!")', { q: 'a"b' })).toBe('Hi a"b!')
        expect(result('combine("Hi {{q}}"; "!")', { q: 'a\\b' })).toBe('Hi a\\b!')
        expect(error('combine("Hi {{q}}"; "!")', { q: 'a"b' })).toBeNull()
    })

    it('serializes object and list values as JSON', () => {
        expect(result('combine("{{o}}"; "")', { o: { a: 1 } })).toBe('{"a":1}')
        expect(result('combine("{{l}}"; "")', { l: [1, 2] })).toBe('[1,2]')
    })

    it('leaves a template with no closing braces alone', () => {
        expect(result('combine("literal {{"; "x")')).toBe('literal {{x')
    })

    it('does not treat a quoted literal as a reference outside a formula', () => {
        const evaluated = formulaEvaluator.evaluate({ expression: 'Hi {{name}}, "x"', sampleData: { name: 'Ann' } })
        expect(evaluated.result).toBe('Hi Ann, "x"')
    })

    it('still resolves bare references as values, not text', () => {
        expect(result('is_number({{n}})', { n: 5 })).toBe(true)
        expect(result('is_list({{l}})', { l: [1] })).toBe(true)
        expect(result('add({{a}};{{b}})', { a: 1, b: 2 })).toBe(3)
    })
})
