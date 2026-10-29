import { evaluateRaw } from './function-implementations'
import { AP_FUNCTIONS } from './function-registry'

const CURRENT_FORMULA_VERSION = 1
const FORMULA_PREFIX = `ap-formula-v${CURRENT_FORMULA_VERSION}::{`
const FORMULA_SUFFIX = `}::ap-formula-v${CURRENT_FORMULA_VERSION}`
// Mirrored close marker means tokenization is a plain regex split — no
// brace-counting or string-literal tracking needed at the wrapper level.
// `[\s\S]*?` matches any character including newlines, non-greedy so adjacent
// formulas don't merge into one capture. The `v(\d+)` lets us route saved
// flows from older format versions to the right evaluator after we ship v2,
// without a data migration.
const FORMULA_REGEX = /ap-formula-v(\d+)::\{([\s\S]*?)\}::ap-formula-v\1/g

function wrap(expression: string): string {
    return `${FORMULA_PREFIX}${expression}${FORMULA_SUFFIX}`
}

function containsWrapper(input: string): boolean {
    return /ap-formula-v\d+::\{/.test(input)
}

function unwrap(template: string): string {
    return template.replace(FORMULA_REGEX, (_, _version: string, expr: string) => expr)
}

function evaluate({ expression, sampleData }: EvaluateExpressionParams): EvaluateExpressionResult {
    const trimmed = expression.trim()
    if (!trimmed) return { result: '', error: null }

    const segments = tokenizeFormulaTemplate(trimmed)
    if (segments.length === 0) return { result: '', error: null }

    if (segments.length === 1 && segments[0].type === 'formula') {
        return evaluateSingleFormula({ expression: segments[0].value, sampleData })
    }

    const parts: string[] = []
    for (const seg of segments) {
        if (seg.type === 'text') {
            parts.push(resolveTextVars(seg.value, sampleData))
            continue
        }
        const { result, error } = evaluateSingleFormula({ expression: seg.value, sampleData })
        if (error) return { result: null, error }
        parts.push(result != null ? (typeof result === 'object' ? JSON.stringify(result) : String(result)) : '')
    }
    return { result: parts.join(''), error: null }
}

function tokenizeFormulaTemplate(template: string): Segment[] {
    const segments: Segment[] = []
    let lastIndex = 0
    for (const match of template.matchAll(FORMULA_REGEX)) {
        const start = match.index ?? 0
        if (start > lastIndex) {
            segments.push({ type: 'text', value: template.slice(lastIndex, start) })
        }
        segments.push({ type: 'formula', value: match[2], version: Number(match[1]) })
        lastIndex = start + match[0].length
    }
    if (lastIndex < template.length) {
        segments.push({ type: 'text', value: template.slice(lastIndex) })
    }
    return segments.filter((s) => s.value !== '')
}

function evaluateSingleFormula({ expression, sampleData }: EvaluateExpressionParams): EvaluateExpressionResult {
    const trimmed = expression.trim()
    if (!trimmed) return { result: '', error: null }
    const emptyArgError = validateFunctionArgs(trimmed)
    if (emptyArgError) return { result: null, error: emptyArgError }

    const { processed, vars } = preprocessExpression({ expression: trimmed, sampleData })
    try {
        return { result: evaluateRaw(processed, vars), error: null }
    }
    catch (e) {
        return { result: null, error: friendlyError(e) }
    }
}

function preprocessExpression({ expression, sampleData }: EvaluateExpressionParams): { processed: string, vars: Record<string, unknown> } {
    const vars: Record<string, unknown> = {}
    const substituted = substituteVariableReferences(expression, sampleData, vars)
    const idxRef = { value: substituted.count }
    const withJsonVars = replaceInlineJsonArrays(substituted.expression, vars, idxRef)
    const withListVars = replaceListLiterals(withJsonVars, vars, idxRef)
    return { processed: normalizeExpression(rewriteLazyIf(wrapStringArgs(withListVars))), vars }
}

// `{{path}}` references are substituted before tokenizing. Outside a string
// literal a reference becomes an internal placeholder so the evaluator sees a
// typed value (number, list, object). Inside a string literal it must become the
// value's TEXT instead: nothing resolves a placeholder inside quotes, so the old
// blind regex replace leaked the internal name into the output —
// `combine("Hi {{name}}"; "!")` returned "Hi __ap_v0__!" instead of "Hi Ann!".
// The substitution therefore walks the expression quote by quote, and escapes
// backslashes / the active quote so the rewritten literal still parses.
function substituteVariableReferences(
    expression: string,
    sampleData: Record<string, unknown>,
    vars: Record<string, unknown>,
): { expression: string, count: number } {
    let result = ''
    let i = 0
    let inString: '"' | '\'' | null = null
    let count = 0

    while (i < expression.length) {
        const ch = expression[i]

        if (inString) {
            if (ch === '\\' && i + 1 < expression.length) {
                result += ch + expression[i + 1]
                i += 2
                continue
            }
            if (ch === inString) {
                inString = null
                result += ch
                i++
                continue
            }
            if (ch === '{' && expression[i + 1] === '{') {
                const close = expression.indexOf('}}', i + 2)
                const path = close === -1 ? null : expression.slice(i + 2, close)
                if (path !== null && isVariablePath(path)) {
                    const value = resolveVariable(path.trim(), sampleData)
                    result += escapeForQuotedLiteral(stringifyForText(value), inString)
                    i = close + 2
                    continue
                }
            }
            result += ch
            i++
            continue
        }

        if (ch === '"' || ch === '\'') {
            inString = ch
            result += ch
            i++
            continue
        }

        if (ch === '{' && expression[i + 1] === '{') {
            const close = expression.indexOf('}}', i + 2)
            const path = close === -1 ? null : expression.slice(i + 2, close)
            if (path !== null && isVariablePath(path)) {
                const key = `__ap_v${count++}__`
                const resolved = resolveVariable(path.trim(), sampleData)
                vars[key] = resolved === undefined ? null : resolved
                result += key
                i = close + 2
                continue
            }
        }

        result += ch
        i++
    }

    return { expression: result, count }
}

// A reference may not itself contain braces (that is the `{{ {object} }}` form,
// which this evaluator never supported — leave it as text).
function isVariablePath(path: string): boolean {
    const trimmed = path.trim()
    return trimmed !== '' && !/[{}]/.test(trimmed)
}

function stringifyForText(value: unknown): string {
    if (value == null) return ''
    if (typeof value === 'string') return value
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value)
        }
        catch {
            return String(value)
        }
    }
    return String(value)
}

function escapeForQuotedLiteral(text: string, quote: '"' | '\''): string {
    const escapedBackslashes = text.replace(/\\/g, '\\\\')
    return quote === '"'
        ? escapedBackslashes.replace(/"/g, '\\"')
        : escapedBackslashes.replace(/'/g, '\\\'')
}

function rewriteLazyIf(expr: string): string {
    const ifOnly = new Set(['if'])
    let result = ''
    let pos = 0
    while (pos < expr.length) {
        const next = findNextFunctionCall(expr, pos, ifOnly)
        if (next === null) {
            result += expr.slice(pos)
            break
        }
        result += expr.slice(pos, next.start)
        const closePos = findMatchingParen(expr, next.openParen)
        if (closePos === -1) {
            result += expr.slice(next.start)
            break
        }
        const argsContent = expr.slice(next.openParen + 1, closePos)
        const args = splitArgsBySemicolon(argsContent).map((a) => rewriteLazyIf(a))
        if (args.length === 3) {
            result += `((${args[0]}) ? (${args[1]}) : (${args[2]}))`
        }
        else {
            result += 'if(' + args.join(';') + ')'
        }
        pos = closePos + 1
    }
    return result
}

function replaceInlineJsonArrays(
    expr: string,
    vars: Record<string, unknown>,
    idxRef: { value: number },
): string {
    let result = ''
    let i = 0
    let inString: '"' | '\'' | null = null

    while (i < expr.length) {
        const ch = expr[i]

        if (inString) {
            if (ch === inString && expr[i - 1] !== '\\') inString = null
            result += ch
            i++
            continue
        }

        if (ch === '"' || ch === '\'') {
            inString = ch
            result += ch
            i++
            continue
        }

        if (ch === '[') {
            let j = i + 1
            while (j < expr.length && (expr[j] === ' ' || expr[j] === '\t')) j++
            if (j < expr.length && expr[j] === '{') {
                const end = findMatchingSquareBracket(expr, i)
                if (end !== -1) {
                    const jsonStr = expr.slice(i, end + 1)
                    try {
                        const parsed = JSON.parse(jsonStr) as unknown
                        if (Array.isArray(parsed)) {
                            const key = `__ap_v${idxRef.value++}__`
                            vars[key] = parsed
                            result += key
                            i = end + 1
                            continue
                        }
                    }
                    catch {
                        // not valid JSON — fall through and include as-is
                    }
                }
            }
        }

        result += ch
        i++
    }

    return result
}

// The registry documents list literals as `[item;item;item]` where bare words
// are ITEM TEXT, not identifiers — `count( [bug;urgent;backend] )`,
// `first_item( [apple;banana;cherry] )`, `flatten( [[a;b];[c;d]] )`. expr-eval
// instead reads `bug` as a variable and throws "bug is not defined", so every
// documented list example failed with "Could not evaluate this formula" (and
// `is_list([a;b;c])` returned false because the whole literal was quoted into a
// string as a union-typed arg). Resolve the literal to a real array up front and
// swap in a `__ap_vN__` placeholder, exactly like replaceInlineJsonArrays does
// for JSON arrays: the rest of the pipeline then sees an opaque value instead of
// bare identifiers.
//
// Only literals whose every item is a plain value are converted — anything that
// needs the evaluator (arithmetic, nested calls, object literals) is left alone
// so expr-eval keeps handling it. Member access (`{{rows}}[0]`) never reaches
// this point (the variable is already a placeholder) and is also skipped
// explicitly.
function replaceListLiterals(
    expr: string,
    vars: Record<string, unknown>,
    idxRef: { value: number },
): string {
    let result = ''
    let i = 0
    let inString: '"' | '\'' | null = null

    while (i < expr.length) {
        const ch = expr[i]

        if (inString) {
            if (ch === inString && expr[i - 1] !== '\\') inString = null
            result += ch
            i++
            continue
        }

        if (ch === '"' || ch === '\'') {
            inString = ch
            result += ch
            i++
            continue
        }

        if (ch === '[' && !isMemberAccess(expr, i)) {
            const end = findMatchingSquareBracket(expr, i)
            if (end !== -1) {
                const items = parseListLiteral(expr.slice(i + 1, end), vars)
                if (items) {
                    const key = `__ap_v${idxRef.value++}__`
                    vars[key] = items
                    result += key
                    i = end + 1
                    continue
                }
            }
        }

        result += ch
        i++
    }

    return result
}

function isMemberAccess(expr: string, bracketPos: number): boolean {
    for (let i = bracketPos - 1; i >= 0; i--) {
        const ch = expr[i]
        if (/\s/.test(ch)) continue
        return /[\w)\]"']/.test(ch)
    }
    return false
}

function parseListLiteral(content: string, vars: Record<string, unknown>): unknown[] | null {
    const items = splitListItems(content)
    if (items === null) return null
    if (items.length === 0) return []

    const values: unknown[] = []
    for (const rawItem of items) {
        const item = rawItem.trim()
        if (!item) return null

        if (item.startsWith('[')) {
            const end = findMatchingSquareBracket(item, 0)
            if (end !== item.length - 1) return null
            const nested = parseListLiteral(item.slice(1, end), vars)
            if (nested === null) return null
            values.push(nested)
            continue
        }
        if (item.startsWith('{')) return null
        if (isQuotedLiteral(item)) {
            values.push(unquoteLiteral(item))
            continue
        }
        if (/^__ap_v\d+__$/.test(item)) {
            values.push(vars[item])
            continue
        }
        if (/^-?(\d+(\.\d+)?|\.\d+)$/.test(item)) {
            values.push(Number(item))
            continue
        }
        if (item === 'true' || item === 'false') {
            values.push(item === 'true')
            continue
        }
        if (item === 'null') {
            values.push(null)
            continue
        }
        // Anything that may need the evaluator (calls, operators, parens) is
        // left to expr-eval by bailing out of the whole literal. `-` is only a
        // problem between digits (subtraction) — `ACC-7890` is item text.
        if (/[()+/%^<>=!&|*]/.test(item) || /\d\s*-\s*\d/.test(item)) return null
        values.push(item)
    }
    return values
}

// Splits `a;b;c` / `a,b,c` on top-level separators only. Returns null when the
// content has unbalanced brackets — the caller then leaves the text untouched.
function splitListItems(content: string): string[] | null {
    if (!content.trim()) return []
    const items: string[] = []
    let current = ''
    let depth = 0
    let inString: '"' | '\'' | null = null

    for (let i = 0; i < content.length; i++) {
        const ch = content[i]
        if (inString) {
            if (ch === '\\') {
                current += ch + (content[i + 1] ?? '')
                i++
                continue
            }
            if (ch === inString) inString = null
            current += ch
            continue
        }
        if (ch === '"' || ch === '\'') {
            inString = ch
            current += ch
            continue
        }
        if (ch === '(' || ch === '[') {
            depth++
            current += ch
            continue
        }
        if (ch === ')' || ch === ']') {
            depth--
            if (depth < 0) return null
            current += ch
            continue
        }
        if ((ch === ';' || ch === ',') && depth === 0) {
            items.push(current)
            current = ''
            continue
        }
        current += ch
    }

    if (depth !== 0 || inString !== null) return null
    items.push(current)
    return items
}

function isQuotedLiteral(value: string): boolean {
    if (value.length < 2) return false
    const quote = value[0]
    if (quote !== '"' && quote !== '\'') return false
    if (value[value.length - 1] !== quote) return false
    // The closing quote must not be escaped.
    return value[value.length - 2] !== '\\'
}

function unquoteLiteral(value: string): string {
    return value.slice(1, -1).replace(/\\(["'\\])/g, '$1')
}

function wrapStringArgs(expr: string): string {
    const fnNames = new Set(AP_FUNCTIONS.map((f) => f.name))
    let result = ''
    let pos = 0

    while (pos < expr.length) {
        const next = findNextFunctionCall(expr, pos, fnNames)

        if (next === null) {
            result += expr.slice(pos)
            break
        }

        result += expr.slice(pos, next.start)

        const fnName = expr.slice(next.start, next.openParen).trim()
        const fn = AP_FUNCTIONS.find((f) => f.name === fnName)
        const closePos = findMatchingParen(expr, next.openParen)

        if (closePos === -1) {
            result += expr.slice(next.start)
            break
        }

        const argsContent = expr.slice(next.openParen + 1, closePos)
        const argParts = splitArgsBySemicolon(argsContent)

        const processedArgs = argParts.map((arg, i) => {
            const inner = wrapStringArgs(arg)
            if (!fn) return inner
            const expectedSpec = fn.argTypes[Math.min(i, fn.argTypes.length - 1)]
            const shouldQuote = expectedSpec === 'string' ||
                (Array.isArray(expectedSpec) && (expectedSpec as string[]).includes('string'))
            return shouldQuote ? quoteIfBare(inner) : inner
        })

        result += fnName + '(' + processedArgs.join(';') + ')'
        pos = closePos + 1
    }

    return result
}

function quoteIfBare(arg: string): string {
    const trimmed = arg.trim()
    if (!trimmed) return arg
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith('\'') && trimmed.endsWith('\''))) return arg
    if (trimmed.startsWith('__ap_')) return arg
    const fnCallMatch = trimmed.match(/^([a-z_][a-z0-9_]*)\s*\(/i)
    if (fnCallMatch && AP_FUNCTIONS.some((f) => f.name === fnCallMatch[1])) return arg
    return '"' + arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

function normalizeExpression(expr: string): string {
    let result = ''
    let inString: '"' | '\'' | null = null
    let i = 0

    while (i < expr.length) {
        const ch = expr[i]

        if (inString) {
            if (ch === inString && (i === 0 || expr[i - 1] !== '\\')) inString = null
            result += ch
            i++
            continue
        }

        if (ch === '"' || ch === '\'') {
            inString = ch
            result += ch
            i++
            continue
        }

        if (ch === ';') {
            result += ','
            i++
            continue
        }

        // Rewrite reserved keyword function calls to aliased names.
        // Only rewrite when the keyword is not preceded by a word character
        // (avoids matching e.g. "understand(" or "anderson(").
        const prevIsWord = i > 0 && /[a-zA-Z0-9_]/.test(expr[i - 1])
        if (!prevIsWord) {
            const rest = expr.slice(i)
            if (rest.startsWith('and('))   {
                result += 'ap_and(';   i += 4; continue
            }
            if (rest.startsWith('or('))    {
                result += 'ap_or(';    i += 3; continue
            }
            if (rest.startsWith('not('))   {
                result += 'ap_not(';   i += 4; continue
            }
            if (rest.startsWith('round(')) {
                result += 'ap_round('; i += 6; continue
            }
            // `length` is shadowed the same way `round` is: expr-eval treats it
            // as a BUILT-IN UNARY OPERATOR (code units of the operand), so a
            // registered parser.functions.length never runs and the documented
            // length() counted UTF-16 units. Rewrite to the aliased impl.
            if (rest.startsWith('length(')) {
                result += 'ap_length('; i += 7; continue
            }
        }

        result += ch
        i++
    }

    return result
}

function validateFunctionArgs(expr: string): string | null {
    const fnNames = new Set(AP_FUNCTIONS.map((f) => f.name))
    let pos = 0
    while (pos < expr.length) {
        const next = findNextFunctionCall(expr, pos, fnNames)
        if (!next) break
        const closePos = findMatchingParen(expr, next.openParen)
        // Advance inside the paren so nested calls are also validated
        pos = next.openParen + 1
        if (closePos === -1) continue

        const fnName = expr.slice(next.start, next.openParen).trim()
        const argsContent = expr.slice(next.openParen + 1, closePos)
        const argParts = splitArgsBySemicolon(argsContent)

        // Only flag empties when separators are present — zero-arg calls are fine
        if (argParts.length > 1) {
            for (let i = 0; i < argParts.length; i++) {
                if (!argParts[i].trim()) {
                    return `${fnName}() is missing value ${i + 1} — fill in all values`
                }
            }
        }
    }
    return null
}

function friendlyError(e: unknown): string {
    const msg = String((e as Error).message ?? e)
    if (/division by zero/i.test(msg)) {
        return 'Cannot divide by zero'
    }
    if (/parse error|Expected EOF|unexpected token|value expected|unexpected \)/i.test(msg)) {
        return 'Invalid formula — check for empty values or mismatched parentheses'
    }
    if (/is not defined/i.test(msg)) {
        const m = msg.match(/(\w+) is not defined/)
        return m
            ? `"${m[1]}" is not a known function or variable — check for typos`
            : 'Unknown function or variable — check for typos'
    }
    if (/wrong number of arguments/i.test(msg)) {
        return 'Wrong number of values — check the function reference for the expected inputs'
    }
    if (/not a function/i.test(msg)) {
        return 'That value is not callable as a function'
    }
    return 'Could not evaluate this formula — check all values are filled in correctly'
}

function resolveTextVars(text: string, sampleData: Record<string, unknown>): string {
    return text.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
        const resolved = resolveVariable(path.trim(), sampleData)
        return resolved != null ? String(resolved) : ''
    })
}

function resolveVariable(path: string, sampleData: Record<string, unknown>): unknown {
    const parts = path.split('.')
    let value: unknown = sampleData
    for (const part of parts) {
        if (value == null || typeof value !== 'object') return undefined
        value = (value as Record<string, unknown>)[part]
    }
    return value
}

function splitArgsBySemicolon(content: string): string[] {
    const args: string[] = []
    let current = ''
    let depth = 0
    let inString: '"' | '\'' | null = null

    for (let i = 0; i < content.length; i++) {
        const ch = content[i]
        if (inString) {
            if (ch === inString && content[i - 1] !== '\\') inString = null
            current += ch
        }
        else if (ch === '"' || ch === '\'') {
            inString = ch; current += ch
        }
        else if (ch === '(') {
            depth++; current += ch
        }
        else if (ch === ')') {
            depth--; current += ch
        }
        else if (ch === ';' && depth === 0) {
            args.push(current); current = ''
        }
        else {
            current += ch
        }
    }
    args.push(current)
    return args
}

function findNextFunctionCall(
    text: string,
    fromPos: number,
    fnNames: Set<string>,
): { start: number, openParen: number } | null {
    for (let i = fromPos; i < text.length; i++) {
        if (!/[a-z_]/i.test(text[i])) continue
        const wordMatch = text.slice(i).match(/^([a-z_][a-z0-9_]*)\s*\(/i)
        if (wordMatch && fnNames.has(wordMatch[1])) {
            const openParen = i + wordMatch[0].length - 1
            return { start: i, openParen }
        }
    }
    return null
}

function findMatchingParen(text: string, openPos: number): number {
    let depth = 0
    let inString: '"' | '\'' | null = null
    for (let i = openPos; i < text.length; i++) {
        const ch = text[i]
        if (inString) {
            if (ch === inString && (i === 0 || text[i - 1] !== '\\')) inString = null
        }
        else if (ch === '"' || ch === '\'') {
            inString = ch
        }
        else if (ch === '(') {
            depth++
        }
        else if (ch === ')') {
            depth--
            if (depth === 0) return i
        }
    }
    return -1
}

function findMatchingSquareBracket(text: string, openPos: number): number {
    let depth = 0
    let inStr: '"' | '\'' | null = null
    for (let i = openPos; i < text.length; i++) {
        const ch = text[i]
        if (inStr) {
            if (ch === inStr && (i === 0 || text[i - 1] !== '\\')) inStr = null
        }
        else if (ch === '"' || ch === '\'') {
            inStr = ch
        }
        else if (ch === '[') {
            depth++
        }
        else if (ch === ']') {
            depth--
            if (depth === 0) return i
        }
    }
    return -1
}

export const formulaEvaluator = {
    evaluate,
    wrap,
    unwrap,
    containsWrapper,
    PREFIX: FORMULA_PREFIX,
    SUFFIX: FORMULA_SUFFIX,
}

export type EvaluateExpressionParams = {
    expression: string
    sampleData: Record<string, unknown>
}

export type EvaluateExpressionResult = {
    result: unknown
    error: string | null
}

type Segment =
    | { type: 'text', value: string }
    | { type: 'formula', value: string, version: number }
