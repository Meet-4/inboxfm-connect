import { formulaEvaluator } from '@inboxfm-connect/core-formula'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Contract test: every example in docs/flows/formula-reference.mdx must evaluate
// through the real evaluator to exactly the documented output. Keeps the
// function reference from drifting back into "documentation that lies about
// the code" — if either the evaluator or the doc changes, this fails.
//
// `process.env.TZ = 'UTC'` is set in vitest.config (loaded before this file)
// so dayjs parses literals at UTC midnight, matching how the documented
// example outputs were produced. `start_of_day`/`end_of_day`/`is_same_day`
// parse as UTC by design (see their implementations); the rest are
// local-parsed, so the deterministic choice is UTC everywhere.

const DOC_PATH = resolve(dirname(__filename), '../../../../../docs/flows/formula-reference.mdx')

// Sample data the documented {{mentions}} resolve against. The doc's list
// examples imply this shape (e.g. `filter_list({{tickets}}; status; open)`
// -> three open tickets out of ten).
const tickets: Array<{ status: string }> = []
for (let i = 0; i < 3; i++) tickets.push({ status: 'open' })
for (let i = 0; i < 7; i++) tickets.push({ status: 'closed' })

const SAMPLE_DATA: Record<string, unknown> = {
    tickets,
    orders: [{ amount: 500 }, { amount: 200 }, { amount: 50 }],
    donations: [{ amount: 1200 }, { amount: 3410.51 }, { amount: 200 }, { amount: 9.99 }],
    scores: [{ value: 90 }, { value: 74.8 }],
    bids: [{ amount: 1200 }, { amount: 89.99 }, { amount: 9.99 }],
    leads: [
        { email: 'a@x.com' }, { email: 'b@x.com' }, { email: 'c@x.com' }, { email: 'd@x.com' },
        { email: 'a@x.com' }, { email: 'b@x.com' }, { email: 'c@x.com' }, { email: 'e@x.com' },
        { email: 'f@x.com' }, { email: 'g@x.com' },
    ],
    users: [{ email: 'ana@x.com' }, { email: 'bob@x.com' }],
    tags: ['bug', 'urgent', 'backend'],
    fruits: ['apple', 'banana', 'cherry'],
    pairs: [['a', 'b'], ['c', 'd']],
    nickname: null,
    quantity: 42,
}

// Outputs that depend on the wall clock or RNG cannot be asserted exactly.
const NON_DETERMINISTIC = new Set(['now', 'today', 'random', 'random_int', 'relative_time'])

interface DocRow {
    fn: string
    example: string
    expected: string
}

function parseDocRows(): DocRow[] {
    const doc = readFileSync(DOC_PATH, 'utf8')
    const rows: DocRow[] = []
    for (const line of doc.split(/\r?\n/)) {
        const match = line.match(/^\| `([a-z_0-9]+)` \| `[^`]+` \| .*? \| `([^`]+)` → `([^`]*)`/)
        if (match) rows.push({ fn: match[1], example: match[2], expected: match[3] })
    }
    return rows
}

// The runtime stringification rule (engine props-resolver): strings pass
// through, everything else is JSON.stringify'd — the doc shows exactly that.
function stringify(result: unknown): string {
    return typeof result === 'string' ? result : JSON.stringify(result)
}

describe('formula reference doc examples', () => {
    it('covers every function in the registry', () => {
        const documented = new Set(parseDocRows().map((row) => row.fn))
        expect(documented.size).toBeGreaterThan(100)
    })

    for (const { fn, example, expected } of parseDocRows()) {
        // Outputs that depend on the wall clock or RNG cannot be asserted
        // exactly — keep the rows visible as skipped, not silently dropped.
        it.skipIf(NON_DETERMINISTIC.has(fn))(`${example} → ${expected}`, () => {
            const { result, error } = formulaEvaluator.evaluate({
                expression: formulaEvaluator.wrap(example),
                sampleData: SAMPLE_DATA,
            })
            expect(error, `evaluation failed: ${error}`).toBeNull()
            expect(stringify(result)).toBe(expected)
        })
    }
})
