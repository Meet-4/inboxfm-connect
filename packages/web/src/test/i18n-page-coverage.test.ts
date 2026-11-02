import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Page-translation coverage gate (#702 companion).
 *
 * The key-registration gate in i18n-completeness.test.ts only checks keys that
 * are referenced with t(); it stays green no matter how many pages ship
 * hardcoded English JSX and never call t() at all. This gate closes that hole:
 *
 *   1. every page under src/pages/** and every MCP Hub component under
 *      src/components/mcp/** must reference the translation layer
 *      (useTranslation / react-i18next / i18n.t) unless it is explicitly
 *      allowlisted below with a reason;
 *   2. converted (non-allowlisted) surfaces may not render literal English
 *      JSX text nodes beyond the small LITERAL_EXCEPTIONS list. Text nodes are
 *      extracted from the TypeScript AST, so only real JSX text counts -
 *      TS generics, types and non-JSX code never trigger false positives;
 *   3. every t('...') string key referenced by converted surfaces must be
 *      registered in public/locales/en/translation.json.
 *
 * New pages therefore fail CI until they call t() (or their author consciously
 * adds them to an allowlist with a reason that reviewers can challenge). The
 * allowlist below shrinks as older pages are converted - do not grow it
 * casually, and never remove an entry's justification.
 */

const webRoot = path.resolve(__dirname, '../..')
const pagesDir = path.join(webRoot, 'src', 'pages')
const mcpComponentsDir = path.join(webRoot, 'src', 'components', 'mcp')
const translationFile = path.join(webRoot, 'public', 'locales', 'en', 'translation.json')

const LEGACY = 'legacy-unconverted page awaiting a later i18n round'

const PAGE_ALLOWLIST: Record<string, string> = {
  'actions/detail.tsx': LEGACY,
  'actions/index.tsx': LEGACY,
  'activity/detail.tsx': LEGACY,
  'activity/index.tsx': LEGACY,
  'auth/login.tsx': LEGACY,
  'automations/schedules-detail.tsx': LEGACY,
  'automations/schedules-edit.tsx': LEGACY,
  'automations/schedules-new.tsx': LEGACY,
  'automations/schedules.tsx': LEGACY,
  'automations/triggers-detail.tsx': LEGACY,
  'automations/triggers-edit.tsx': LEGACY,
  'automations/triggers-new.tsx': LEGACY,
  'automations/triggers.tsx': LEGACY,
  'connect/index.tsx': 'owned by open PR #692 - convert in that PR',
  'connections/detail.tsx': LEGACY,
  'connections/index.tsx': LEGACY,
  'connections/new.tsx': LEGACY,
  'dashboard/index.tsx': LEGACY,
  'developers/index.tsx': LEGACY,
  'integrations/detail.tsx': LEGACY,
  'integrations/index.tsx': LEGACY,
  'mcp/index.tsx': 'owned by open PR #738 - extraction deferred to that PR',
  'settings/index.tsx': LEGACY,
  'triggers/index.tsx': LEGACY,
  'welcome/logo-mark.tsx': 'no user-facing strings (pure SVG logo)',
}

const MCP_COMPONENT_ALLOWLIST: Record<string, string> = {
  'mcp-client-config-card.tsx': 'owned by open PR #738 - extraction deferred to that PR',
}

/**
 * Literal JSX text nodes that stay untranslated inside converted surfaces.
 * These are proper nouns / technical tokens, never translatable prose.
 */
const LITERAL_EXCEPTIONS: Record<string, string> = {
  'InboxFM Connect': 'product brand name',
  GitHub: 'proper noun',
  'LICENSING.md': 'file name',
  'Mihir-Rabari/inboxfm-connect': 'repository slug',
  'cak-': 'project API key prefix',
  'sk-': 'platform API key prefix',
}

const TRANSLATION_REFERENCE = /useTranslation|react-i18next|i18n\.t\(/
const T_STRING_CALL = /\bt\(\s*(['"])((?:\\.|(?!\1)[^\\])+?)\1\s*[,)\n]/g

function listSurfaceFiles(dir: string, allowlist: Record<string, string>): string[] {
  const out: string[] = []
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.name.endsWith('.tsx')) continue
      if (entry.name.endsWith('.test.tsx') || entry.name.endsWith('.spec.tsx')) continue
      out.push(path.relative(dir, full).split(path.sep).join('/'))
    }
  }
  walk(dir)
  const unexpected = Object.keys(allowlist).filter((rel) => !out.includes(rel))
  expect(unexpected, 'stale allowlist entries (files no longer exist - remove them)').toEqual([])
  return out
}

function readSurface(dir: string, rel: string): string {
  return fs.readFileSync(path.join(dir, rel), 'utf8')
}

/**
 * Every literal string a TSX file renders as a JSX text node, extracted from
 * the TypeScript AST. Whitespace-only text, numbers and bare punctuation are
 * ignored; everything else with a run of English letters is reported so the
 * caller can decide whether it is translated or allowlisted.
 */
function literalJsxTextNodes(source: string, fileName: string): string[] {
  const ast = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const nodes: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = node.getText(ast).replace(/\s+/g, ' ').trim()
      if (text && /[A-Za-z]{2,}/.test(text)) {
        nodes.push(text)
      }
    }
    node.forEachChild(visit)
  }
  visit(ast)
  return nodes
}

function tStringKeys(source: string): string[] {
  const keys: string[] = []
  let match: RegExpExecArray | null
  while ((match = T_STRING_CALL.exec(source)) !== null) {
    keys.push(match[2])
  }
  return keys
}

interface Surface {
  dir: string
  allowlist: Record<string, string>
  label: string
}

const surfaces: Surface[] = [
  { dir: pagesDir, allowlist: PAGE_ALLOWLIST, label: 'page' },
  { dir: mcpComponentsDir, allowlist: MCP_COMPONENT_ALLOWLIST, label: 'MCP component' },
]

const translationKeys: Record<string, unknown> = JSON.parse(
  fs.readFileSync(translationFile, 'utf8'),
)

function convertedFiles(surface: Surface): string[] {
  return listSurfaceFiles(surface.dir, surface.allowlist).filter((rel) => !(rel in surface.allowlist))
}

describe('i18n page-translation coverage gate', () => {
  it('every page and MCP Hub component references translations or is explicitly allowlisted', () => {
    const violations: string[] = []
    for (const surface of surfaces) {
      for (const rel of listSurfaceFiles(surface.dir, surface.allowlist)) {
        if (rel in surface.allowlist) continue
        const source = readSurface(surface.dir, rel)
        if (!TRANSLATION_REFERENCE.test(source)) {
          violations.push(
            `${surface.label} "${rel}" renders UI without any t() usage - extract its strings into translation keys or add an allowlisted reason`
          )
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('converted surfaces render no hardcoded English JSX text nodes', () => {
    const violations: string[] = []
    for (const surface of surfaces) {
      for (const rel of convertedFiles(surface)) {
        const source = readSurface(surface.dir, rel)
        for (const text of literalJsxTextNodes(source, rel)) {
          if (text in LITERAL_EXCEPTIONS) continue
          violations.push(`hardcoded literal "${text}" in ${rel}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('every t() key referenced by converted surfaces is registered in the translation dictionary', () => {
    const violations: string[] = []
    for (const surface of surfaces) {
      for (const rel of convertedFiles(surface)) {
        const source = readSurface(surface.dir, rel)
        for (const key of tStringKeys(source)) {
          if (!(key in translationKeys)) {
            violations.push(`unregistered key "${key}" used in ${rel}`)
          }
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('canary: a hardcoded-English page fails the gate, a translated page passes it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-coverage-'))

    const violating = path.join(dir, 'violating-page.tsx')
    fs.writeFileSync(
      violating,
      `export default function ViolatingPage() {\n  return (\n    <div>\n      <p>Please rotate your security token before it expires</p>\n      <span>Done</span>\n      <DisabledTools></DisabledTools>\n    </div>\n  )\n}\n`,
      'utf8'
    )
    const violatingSource = fs.readFileSync(violating, 'utf8')
    // the translation-reference gate must catch it...
    expect(TRANSLATION_REFERENCE.test(violatingSource)).toBe(false)
    // ...and so must the literal-English gate (both strings, not just one)
    expect(literalJsxTextNodes(violatingSource, 'violating-page.tsx')).toEqual([
      'Please rotate your security token before it expires',
      'Done',
    ])

    const translated = path.join(dir, 'translated-page.tsx')
    fs.writeFileSync(
      translated,
      `import { useTranslation } from 'react-i18next'\n\nexport default function TranslatedPage() {\n  const { t } = useTranslation()\n  return <p>{t('Everything you need to connect AI to the real world')}</p>\n}\n`,
      'utf8'
    )
    const translatedSource = fs.readFileSync(translated, 'utf8')
    expect(TRANSLATION_REFERENCE.test(translatedSource)).toBe(true)
    expect(literalJsxTextNodes(translatedSource, 'translated-page.tsx')).toEqual([])
    // and its key really is registered, proving the third gate has teeth
    expect('Everything you need to connect AI to the real world' in translationKeys).toBe(true)

    // an unregistered t() key must fail the registration gate
    expect('this key was never registered xyzzy' in translationKeys).toBe(false)
    expect(
      tStringKeys(`export default () => {\n  const { t } = useTranslation()\n  return <p>{t('this key was never registered xyzzy')}</p>\n}\n`)
    ).toEqual(['this key was never registered xyzzy'])

    fs.rmSync(dir, { recursive: true, force: true })
  })
})
