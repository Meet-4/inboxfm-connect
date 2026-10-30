// evlog's RequestLogger.set()/info()/warn()/error() merge field records into
// the wide-event context with a recursive assign (mergeInto) that walks
// `for (const key in source)` and resolves `target[key]` directly. For a
// `__proto__` key on a plain context object that lookup hits the inherited
// accessor and returns Object.prototype — which isPlainObject() accepts — so
// the merge recurses INTO Object.prototype. A JSON.parse'd payload (request
// bodies, webhook payloads, step outputs) carries an own enumerable
// `__proto__` data property, so a single set()/info() call can pollute
// Object.prototype for the whole process.
//
// Every server-utils funnel into that merge (wideEvent.set, wideEvent.audit,
// apLogger fields/bindings) passes through here first. Plain records are
// cloned (callers' objects are neither mutated nor aliased into the log
// context); class instances (Error, Date, Buffer, …) are passed through by
// reference because evlog never recurses into non-plain objects.

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export function sanitizeLogFields<T>(value: T): T {
    return sanitizeValue(value, new WeakSet<object>()) as T
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
    if (value === null || typeof value !== 'object') {
        return value
    }
    if (seen.has(value)) {
        // Cyclic reference: return the original rather than recursing
        // forever. evlog only merges plain objects it can enumerate, and a
        // cycle carried by reference cannot walk Object.prototype.
        return value
    }
    if (Array.isArray(value)) {
        seen.add(value)
        return value.map((item) => sanitizeValue(item, seen))
    }
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) {
        return value
    }
    seen.add(value)
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
        if (DANGEROUS_KEYS.has(key)) {
            continue
        }
        result[key] = sanitizeValue((value as Record<string, unknown>)[key], seen)
    }
    return result
}
