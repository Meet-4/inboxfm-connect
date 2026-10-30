import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { i18n } from '@/lib/i18n'

/**
 * i18n completeness census for the web app.
 *
 * AGENTS.md requires every user-facing web string consumed via
 * `const { t } = useTranslation()` to exist as a key in
 * `packages/web/public/locales/en/translation.json`. A key that is passed to
 * `t()` but missing from the bundle renders the raw key and cannot be
 * translated — the wave-34 `No Project` finding was one instance of this
 * class, and until this test nothing systematically checked for it.
 *
 * This gate mirrors `zod-i18n-enforcement.test.ts` on the server, which
 * already enforces the same contract for Zod validation messages.
 *
 * The census extracts:
 *   1. literal keys — `t('...')`, `t("...")`, `t(\`...\`)` (incl. `i18n.t(...)`)
 *   2. constant-referenced keys — dynamic `t(expr.prop)` calls resolved to the
 *      quoted `prop: '...'` literals in the same file (e.g. the `navGroups`
 *      labels/titles rendered through `t(group.label)` / `t(item.title)`)
 *
 * Test files are excluded: test fixtures are not user-visible surfaces.
 */

const WEB_ROOT = path.resolve(__dirname, '../../')
const SRC_DIR = path.join(WEB_ROOT, 'src')
const BUNDLE_PATH = path.join(WEB_ROOT, 'public/locales/en/translation.json')

/**
 * Keys that are referenced in production code but not yet registered on dev
 * because an open PR already carries the registration hunk. Entries must
 * reference a real PR; the allowlist is hygiene-checked below so it can never
 * outlive the PR it tracks (it fails once the key lands in the bundle, or if
 * the key stops being used).
 */
const PENDING_REGISTRATION: ReadonlyArray<{ key: string; pr: number }> = [
  { key: 'No Project', pr: 697 }, // sidebar.tsx fallback project label; bundle hunk owned by PR #697
]

const LITERAL_CALL_RES: RegExp[] = [
  /\bt\(\s*'((?:[^'\\\n]|\\.)*)'/g,
  /\bt\(\s*"((?:[^"\\\n]|\\.)*)"/g,
  /\bt\(\s*`((?:[^`\\$]|\\.)*)`/g,
]
const DYNAMIC_CALL_RE = /\bt\(\s*([A-Za-z_$][\w$]*(?:\.[\w$]+)+)\s*[,)]/g
const INTERPOLATED_CALL_RE = /\bt\(\s*'((?:[^'\\\n]|\\.)*)'\s*,\s*\{([^}]*)\}/g

function unescapeKey(raw: string): string {
  return raw.replace(/\\(.)/g, '$1')
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walk(full))
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function isTestFile(file: string): boolean {
  const rel = path.relative(SRC_DIR, file).replace(/\\/g, '/')
  return rel.startsWith('test/') || /\.(test|spec)\.[jt]sx?$/.test(rel)
}

function quotedPropertyValues(source: string, prop: string): string[] {
  const rx = new RegExp(
    `\\b${prop}\\s*:\\s*(?:'((?:[^'\\\\\\n]|\\\\.)*)'|"((?:[^"\\\\\\n]|\\\\.)*)")`,
    'g',
  )
  const values: string[] = []
  for (const match of source.matchAll(rx)) {
    values.push(unescapeKey(match[1] ?? match[2]))
  }
  return values
}

type Referenced = Map<string, Set<string>>

function runCensus(): { referenced: Referenced; interpolated: Array<{ key: string; options: string[]; file: string }> } {
  const referenced: Referenced = new Map()
  const interpolated: Array<{ key: string; options: string[]; file: string }> = []
  const add = (key: string, where: string) => {
    const sites = referenced.get(key) ?? new Set<string>()
    sites.add(where)
    referenced.set(key, sites)
  }

  for (const file of walk(SRC_DIR)) {
    if (isTestFile(file)) {
      continue
    }
    const source = fs.readFileSync(file, 'utf8')
    const rel = path.relative(SRC_DIR, file).replace(/\\/g, '/')

    for (const rx of LITERAL_CALL_RES) {
      for (const match of source.matchAll(rx)) {
        add(unescapeKey(match[1]), rel)
      }
    }
    for (const match of source.matchAll(DYNAMIC_CALL_RE)) {
      const prop = match[1].split('.').pop() ?? ''
      for (const value of quotedPropertyValues(source, prop)) {
        add(value, `${rel} [via t(${match[1]})]`)
      }
    }
    for (const match of source.matchAll(INTERPOLATED_CALL_RE)) {
      const options = [...match[2].matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1])
      interpolated.push({ key: unescapeKey(match[1]), options, file: rel })
    }
  }
  return { referenced, interpolated }
}

const bundle: Record<string, string> = JSON.parse(fs.readFileSync(BUNDLE_PATH, 'utf8'))
const { referenced, interpolated } = runCensus()
const pendingKeys = new Set(PENDING_REGISTRATION.map((entry) => entry.key))

describe('i18n completeness census — every t() key in production src is registered in the en bundle', () => {
  it('finds t() usage to census (guards against a silently empty scan)', () => {
    // Snapshot of the wave-35 census: 49 referenced keys (48 registered + 1 pending).
    expect(referenced.size).toBeGreaterThanOrEqual(49)
  })

  it('has a non-empty English bundle', () => {
    expect(Object.keys(bundle).length).toBeGreaterThan(2000)
  })

  it('registers every literal and constant-referenced t() key', () => {
    const unregistered: string[] = []
    for (const [key, sites] of referenced) {
      if (!pendingKeys.has(key) && !(key in bundle)) {
        unregistered.push(`  ${JSON.stringify(key)} <- ${[...sites].sort().join(', ')}`)
      }
    }
    expect(
      unregistered,
      `Found ${unregistered.length} t() key(s) missing from ${BUNDLE_PATH}.\n` +
        'A missing key renders the raw key string to users and cannot be translated.\n' +
        'Fix: add an identity mapping to the English bundle (AGENTS.md: "never use raw English sentences that are not in the translation file").\n' +
        unregistered.join('\n'),
    ).toStrictEqual([])
  })

  it('resolves every registered reference at i18n runtime (catches keySeparator lookups)', () => {
    const unresolved: string[] = []
    for (const key of referenced.keys()) {
      if (!pendingKeys.has(key) && key in bundle && !i18n.exists(key)) {
        unresolved.push(key)
      }
    }
    expect(
      unresolved,
      `Keys exist in the bundle JSON but i18n.exists() returns false — the runtime cannot resolve them.\n` +
        unresolved.join('\n'),
    ).toStrictEqual([])
  })

  it('keeps the pending-registration allowlist honest', () => {
    const stale: string[] = []
    for (const { key, pr } of PENDING_REGISTRATION) {
      if (!referenced.has(key)) {
        stale.push(`${JSON.stringify(key)} (PR #${pr}): no longer referenced in src — remove the allowlist entry`)
      }
      if (key in bundle) {
        stale.push(`${JSON.stringify(key)} (PR #${pr}): already registered in the bundle — remove the allowlist entry`)
      }
    }
    expect(stale, `Pending-registration entries that need cleanup:\n${stale.join('\n')}`).toStrictEqual([])
  })

  it('matches interpolated t() call options to bundle placeholders', () => {
    const mismatches: string[] = []
    for (const { key, options, file } of interpolated) {
      if (pendingKeys.has(key)) {
        continue
      }
      const value = bundle[key]
      if (value === undefined) {
        continue // reported by the registration assertion above
      }
      for (const option of options) {
        const placeholder = new RegExp(`\\{\\{\\s*${option}\\s*\\}\\}`)
        if (!placeholder.test(value)) {
          mismatches.push(`  ${JSON.stringify(key)}: option "${option}" passed at ${file} but bundle value ${JSON.stringify(value)} has no {{${option}}} placeholder`)
        }
      }
    }
    expect(
      mismatches,
      `Interpolated t() calls whose options are absent from the bundle value render empty strings for those options.\n` +
        mismatches.join('\n'),
    ).toStrictEqual([])
  })
})
