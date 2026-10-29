import { groupBy } from '../src/lib/object-utils'

// A grouping key is data — it comes from a record field, a webhook payload, a
// user-supplied label. Building the result with `result[key]` on a `{}` meant
// any key that exists on Object.prototype (`__proto__`, `constructor`,
// `toString`, `valueOf`, ...) hit the inherited member instead of a fresh array:
// `__proto__`/`constructor` threw "result[key].push is not a function" and
// `toString` did the same, while `hasOwnProperty`-style lookups silently
// returned the wrong bucket.
describe('groupBy with keys that exist on Object.prototype', () => {
    it('groups by __proto__ without throwing', () => {
        const result = groupBy([{ k: '__proto__', id: 1 }, { k: '__proto__', id: 2 }], (item) => item.k)
        expect(result['__proto__']).toEqual([{ k: '__proto__', id: 1 }, { k: '__proto__', id: 2 }])
        expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(true)
    })

    it('groups by constructor without throwing', () => {
        const result = groupBy([{ k: 'constructor', id: 1 }], (item) => item.k)
        expect(result['constructor']).toEqual([{ k: 'constructor', id: 1 }])
        expect(Object.prototype.hasOwnProperty.call(result, 'constructor')).toBe(true)
    })

    it('groups by toString without throwing', () => {
        const result = groupBy([{ k: 'toString', id: 1 }], (item) => item.k)
        expect(result['toString']).toEqual([{ k: 'toString', id: 1 }])
    })

    it('groups by valueOf and hasOwnProperty', () => {
        const result = groupBy(
            [{ k: 'valueOf', id: 1 }, { k: 'hasOwnProperty', id: 2 }],
            (item) => item.k,
        )
        expect(result['valueOf']).toEqual([{ k: 'valueOf', id: 1 }])
        expect(result['hasOwnProperty']).toEqual([{ k: 'hasOwnProperty', id: 2 }])
    })

    it('does not pollute Object.prototype', () => {
        groupBy([{ k: '__proto__', id: 1 }], (item) => item.k)
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
        expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'id')).toBe(false)
    })
})

describe('groupBy unchanged behaviour', () => {
    it('groups ordinary keys', () => {
        const users = [
            { id: 1, department: 'engineering' },
            { id: 2, department: 'sales' },
            { id: 3, department: 'engineering' },
        ]
        expect(groupBy(users, (u) => u.department)).toEqual({
            engineering: [{ id: 1, department: 'engineering' }, { id: 3, department: 'engineering' }],
            sales: [{ id: 2, department: 'sales' }],
        })
    })

    it('returns a normal object (not null-prototype)', () => {
        const result = groupBy([{ k: 'a' }], (item) => item.k)
        expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    })

    it('returns an empty object for an empty array', () => {
        expect(groupBy([], (item: { k: string }) => item.k)).toEqual({})
    })

    it('accepts numeric keys', () => {
        const result = groupBy([{ n: 1 }, { n: 2 }, { n: 1 }], (item) => item.n)
        expect(result[1]).toHaveLength(2)
        expect(result[2]).toHaveLength(1)
    })
})
