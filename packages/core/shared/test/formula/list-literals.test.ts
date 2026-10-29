import { formulaEvaluator } from '@inboxfm-connect/core-formula'
import { describe, expect, it } from 'vitest'

const result = (expr: string, data: Record<string, unknown> = {}) =>
    formulaEvaluator.evaluate({ expression: formulaEvaluator.wrap(expr), sampleData: data }).result

const error = (expr: string, data: Record<string, unknown> = {}) =>
    formulaEvaluator.evaluate({ expression: formulaEvaluator.wrap(expr), sampleData: data }).error

// The function registry documents list literals as `[item;item;item]` with bare
// words as item text (count( [bug;urgent;backend] ), first_item( [apple;banana;cherry] ),
// flatten( [[a;b];[c;d]] ), ...). expr-eval reads a bare word as a variable, so
// every one of those examples failed with "Could not evaluate this formula".
describe('list literals: registry examples', () => {
    it('count() of a bare-word list', () => {
        expect(error('count([bug;urgent;backend])')).toBeNull()
        expect(result('count([bug;urgent;backend])')).toBe(3)
    })

    it('first_item() / last_item() return the item text', () => {
        expect(result('first_item([apple;banana;cherry])')).toBe('apple')
        expect(result('last_item([apple;banana;cherry])')).toBe('cherry')
    })

    it('item_at() indexes a literal list', () => {
        expect(result('item_at([apple;banana;cherry];1)')).toBe('banana')
    })

    it('join_list() joins literal items with the separator', () => {
        expect(result('join_list([bug;urgent;backend];", ")')).toBe('bug, urgent, backend')
    })

    it('reverse_list() reverses a literal list', () => {
        expect(result('reverse_list([a;b;c])')).toEqual(['c', 'b', 'a'])
    })

    it('is_list() is true for a literal list (was false: the arg got quoted)', () => {
        expect(result('is_list([a;b;c])')).toBe(true)
    })

    it('contains_item() matches a literal item', () => {
        expect(result('contains_item([bug;urgent;backend];urgent)')).toBe(true)
        expect(result('contains_item([bug;urgent;backend];done)')).toBe(false)
    })

    it('flatten() flattens nested literal lists', () => {
        expect(result('flatten([[a;b];[c;d]])')).toEqual(['a', 'b', 'c', 'd'])
        expect(result('count(flatten([[a;b];[c;d]]))')).toBe(4)
    })
})

describe('list literals: item typing', () => {
    it('keeps numbers as numbers', () => {
        expect(result('count([1;2;3])')).toBe(3)
        expect(result('join_list([1;2;3];"-")')).toBe('1-2-3')
    })

    it('keeps booleans as booleans', () => {
        // A boolean item must stay boolean: not(false) is true, not("false") is false.
        expect(result('not(item_at([false;true];0))')).toBe(true)
        expect(result('is_list([true;false])')).toBe(true)
    })

    it('mixes text and numbers without stringifying the number', () => {
        expect(result('is_equal(item_at([a;2];1);2)')).toBe(true)
        expect(result('item_at([a;2];0)')).toBe('a')
    })

    it('keeps a quoted item verbatim (spaces, commas and semicolons survive)', () => {
        expect(result('item_at(["Hello, world";b];0)')).toBe('Hello, world')
        expect(result('item_at(["a;b";c];0)')).toBe('a;b')
    })

    it('accepts dashes inside item text', () => {
        expect(result('item_at([ACC-7890;sales];0)')).toBe('ACC-7890')
    })

    it('resolves variable items, including list-valued ones', () => {
        expect(result('count([{{a}};{{b}}])', { a: 1, b: 2 })).toBe(2)
        expect(result('join_list([{{a}};z];"-")', { a: 'x' })).toBe('x-z')
        expect(result('flatten([{{inner}};[c]])', { inner: ['a', 'b'] })).toEqual(['a', 'b', 'c'])
    })

    it('empty list literal stays empty', () => {
        expect(result('count([])')).toBe(0)
    })
})

describe('list literals: no interference with existing syntax', () => {
    it('keeps JSON arrays of objects working', () => {
        expect(result('count([{"a":1},{"a":2}])')).toBe(2)
    })

    it('leaves arithmetic items to the evaluator', () => {
        expect(result('item_at([1+2;3];0)')).toBe(3)
    })

    it('member access on a variable is not mistaken for a list literal', () => {
        expect(result('item_at({{rows}};0)', { rows: [{ name: 'first' }, { name: 'second' }] }))
            .toEqual({ name: 'first' })
    })

    it('a list literal inside a quoted string is text, not a list', () => {
        expect(result('contains({{msg}};"[a;b]")', { msg: 'see [a;b] here' })).toBe(true)
    })

    it('list literals nested in function args still quote correctly', () => {
        expect(result('is_equal(join_list([a;b];"-");"a-b")')).toBe(true)
    })
})
