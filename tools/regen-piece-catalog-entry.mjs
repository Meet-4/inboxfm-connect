#!/usr/bin/env node
// Regenerate catalog entries from the REAL piece modules (piece.metadata()) instead of
// stale hand-scraped exports. The catalog is the source MCP/AI tools read for action
// names and input schemas — an entry generated from module exports reports fake action
// names with empty props and poisons every consumer (see issue for the resend case).
//
// Usage:
//   node tools/regen-piece-catalog-entry.mjs <piece-folder> [--write]   # one piece, dry-run by default
//   node tools/regen-piece-catalog-entry.mjs --all [--write]           # every piece with a built dist
//
// Each piece module is loaded in an isolated child process with a hard timeout
// (REGEN_PIECE_TIMEOUT_MS, default 30s): a piece whose import throws or hangs
// is reported as SKIPPED instead of aborting or freezing the whole sweep
// (issue #630 — seven pieces were stuck unloadable that way). Pass
// --in-process to load pieces in this process instead (faster, fragile).
//
// Requires the framework and the target piece(s) to be built first (dist/ present):
//   npx turbo run build --filter=@inboxfm-connect/piece-resend
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CATALOG_PATH = path.join(REPO_ROOT, 'packages/server/api/src/assets/local-integrations-catalog.json')
const WORKER_PATH = path.join(REPO_ROOT, 'tools/regen-piece-metadata-worker.mjs')
const SENTINEL = '<<<REGEN_PIECE_METADATA>>>'
const DEFAULT_PIECE_TIMEOUT_MS = 30_000

const pieceTimeoutMs = Number(process.env['REGEN_PIECE_TIMEOUT_MS'] ?? DEFAULT_PIECE_TIMEOUT_MS)
const require = createRequire(import.meta.url)

// The framework ships as CJS dist; ESM tooling needs createRequire.
const { ToolBase, TriggerBase } = require(path.join(REPO_ROOT, 'packages/integrations/framework/dist/src/index.js'))

const collectValidated = ({ metadata, schema, kind }) => {
    const entries = {}
    const failures = []
    for (const [name, raw] of Object.entries(metadata[kind] ?? {})) {
        // No padding: since the ArrayProperty zod accepts the Property.Array()
        // factory output (issue #629), the serialized props carry the piece's
        // real item schema — declared item `properties` ride through, bare
        // arrays stay bare. The old fabricated `{ item: SHORT_TEXT }`
        // placeholder plus `valueSchema: []` stomp wrote wrong item types
        // into the catalog.
        const serialized = JSON.parse(JSON.stringify(raw))
        const result = schema.safeParse(serialized)
        if (result.success) {
            entries[name] = serialized
        } else {
            failures.push(`${name}: ${result.error.issues[0].path.join('.')} ${result.error.issues[0].message}`)
        }
    }
    return { entries, failures }
}

const findPieceModulePath = ({ folder }) => {
    for (const group of ['community', 'core']) {
        const dir = path.join(REPO_ROOT, 'packages/integrations', group, folder)
        if (fs.existsSync(path.join(dir, 'dist/src/index.js'))) {
            return { dir, entry: path.join(dir, 'dist/src/index.js') }
        }
    }
    return null
}

const extractPiece = (module) => Object.values(module).find((exported) => exported?.metadata && exported?.displayName)

// Same serialization the in-process path always used: JSON round-trip drops
// functions (run handlers, dropdown options) and keeps the props schema records.
const serializeMetadata = (piece) => JSON.parse(JSON.stringify({
    displayName: piece.displayName,
    logoUrl: piece.logoUrl,
    description: piece.description,
    categories: piece.categories,
    authors: piece.authors,
    auth: piece.auth,
    minimumSupportedRelease: piece.minimumSupportedRelease,
    maximumSupportedRelease: piece.maximumSupportedRelease,
    actions: piece.metadata().actions ?? {},
    triggers: piece.metadata().triggers ?? {},
}))

const loadPieceMetadataInProcess = ({ modulePath }) => {
    // --in-process only: every piece loads into this process, so one throwing
    // import fails the run and one hanging import freezes it forever.
    try {
        const module = require(modulePath.entry)
        const piece = extractPiece(module)
        if (!piece) {
            return { error: 'no Piece export' }
        }
        return { metadata: serializeMetadata(piece) }
    } catch (error) {
        return { error: `dist not loadable: ${error && error.message ? error.message : String(error)}` }
    }
}

const parseWorkerOutput = (stdout) => {
    const index = stdout.indexOf(SENTINEL)
    if (index === -1) {
        return null
    }
    try {
        return JSON.parse(stdout.slice(index + SENTINEL.length).trim())
    } catch {
        return null
    }
}

const loadPieceMetadataIsolated = ({ modulePath }) => {
    // One child process per piece (issue #630): throws and top-level hangs in a
    // piece's import are contained and time-bounded instead of poisoning the
    // whole sweep. The worker anchors module resolution at the piece package
    // root, so raw tsc dists resolve their runtime deps before the repo root.
    const run = spawnSync(process.execPath, [WORKER_PATH, modulePath.dir, modulePath.entry], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: pieceTimeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: 128 * 1024 * 1024,
    })
    if (run.error || run.signal) {
        const timedOut = run.error?.code === 'ETIMEDOUT' || run.signal === 'SIGKILL'
        return { error: timedOut ? `dist not loadable: import timed out after ${pieceTimeoutMs}ms in isolated child` : 'dist not loadable: isolated child killed' }
    }
    const payload = parseWorkerOutput(run.stdout ?? '')
    if (!payload) {
        return { error: `dist not loadable: worker exit ${run.status} without metadata payload` }
    }
    if (payload.error) {
        return { error: payload.error }
    }
    return { metadata: payload }
}

const buildEntry = ({ piece, actions, triggers, existing, version }) => ({
    displayName: piece.displayName,
    logoUrl: piece.logoUrl,
    description: piece.description || existing.description,
    version,
    minimumSupportedRelease: piece.minimumSupportedRelease || '0.0.0',
    maximumSupportedRelease: piece.maximumSupportedRelease || '999.999.999',
    categories: Array.isArray(piece.categories) ? piece.categories : ['COMMUNICATION'],
    authors: Array.isArray(piece.authors) ? piece.authors : [],
    auth: { type: piece.auth?.type || 'SECRET_TEXT' },
    actions,
    triggers,
})

const regenPiece = ({ folder, catalog, write, isolate }) => {
    const modulePath = findPieceModulePath({ folder })
    if (!modulePath) {
        return { piece: folder, status: 'SKIPPED (no built dist)', failures: [] }
    }
    const piecePackage = JSON.parse(fs.readFileSync(path.join(modulePath.dir, 'package.json'), 'utf8'))
    const loaded = isolate
        ? loadPieceMetadataIsolated({ modulePath })
        : loadPieceMetadataInProcess({ modulePath })
    if (loaded.error) {
        return { piece: piecePackage.name, status: `SKIPPED (${loaded.error})`, failures: [] }
    }
    const { metadata } = loaded
    const { entries: actions, failures: actionFailures } = collectValidated({ metadata, schema: ToolBase, kind: 'actions' })
    const { entries: triggers, failures: triggerFailures } = collectValidated({ metadata, schema: TriggerBase, kind: 'triggers' })
    const index = catalog.findIndex((p) => p.name === piecePackage.name)
    if (index === -1) {
        return { piece: piecePackage.name, status: 'SKIPPED (not in catalog)', failures: [...actionFailures, ...triggerFailures] }
    }
    const entry = buildEntry({ piece: metadata, actions, triggers, existing: catalog[index], version: piecePackage.version })
    const merged = { ...catalog[index], ...entry }
    const current = { ...catalog[index] }
    delete current.updated
    const candidate = { ...merged }
    delete candidate.updated
    const changed = JSON.stringify(current) !== JSON.stringify(candidate)
    if (changed && write) {
        catalog[index] = { ...merged, updated: new Date().toISOString() }
    }
    return {
        piece: piecePackage.name,
        status: changed ? (write ? 'PATCHED' : 'CHANGED (dry-run)') : 'OK (no drift)',
        failures: [...actionFailures, ...triggerFailures],
    }
}

const main = () => {
    const args = process.argv.slice(2)
    const write = args.includes('--write')
    const all = args.includes('--all')
    const isolate = !args.includes('--in-process')
    const folders = all
        ? ['community', 'core'].flatMap((group) => fs.readdirSync(path.join(REPO_ROOT, 'packages/integrations', group)).map((folder) => folder))
        : args.filter((arg) => !arg.startsWith('--'))
    if (folders.length === 0) {
        console.error('usage: regen-piece-catalog-entry.mjs <piece-folder> [--write] | --all [--write] [--in-process]')
        process.exit(2)
    }
    const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'))
    const results = folders.map((folder) => regenPiece({ folder, catalog, write, isolate }))
    for (const result of results) {
        console.log(`${result.status.padEnd(22)} ${result.piece}${result.failures.length ? ` | failures: ${result.failures.join('; ')}` : ''}`)
    }
    const patched = results.filter((result) => result.status === 'PATCHED').length
    if (write && patched > 0) {
        fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2))
        console.log(`\ncatalog updated: ${patched} entr${patched === 1 ? 'y' : 'ies'} patched -> packages/server/api/src/assets/local-integrations-catalog.json`)
    }
    if (results.some((result) => result.failures.length > 0)) {
        process.exit(1)
    }
}

main()
