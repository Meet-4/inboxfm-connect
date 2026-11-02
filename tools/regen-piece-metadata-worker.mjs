#!/usr/bin/env node
// Worker for tools/regen-piece-catalog-entry.mjs — loads ONE piece module in an
// isolated child process and prints its serialized metadata as JSON.
//
// Why a child process (issue #630): a full catalog sweep loads every piece
// module into the tool's process. One piece whose import throws — or worse,
// hangs on a top-level network call or infinite loop — aborts or freezes the
// whole sweep, so those entries never heal (crypto, image-helper,
// actualbudget, amazon-s3, clarifai, postgres, scrapeless were stuck exactly
// like that). The parent spawns this worker per piece with a hard timeout, so
// a bad piece degrades to a per-piece SKIP instead of poisoning the sweep.
//
// Protocol (stdout, sentinel-delimited so module-import console noise can't
// corrupt the payload):
//   <<<REGEN_PIECE_METADATA>>>
//   {"meta":{...},"actions":{...},"triggers":{...}}
// Exit codes: 0 = metadata printed, 3 = no Piece export, 4 = import failed.
import path from 'node:path'
import { createRequire } from 'node:module'

const SENTINEL = '<<<REGEN_PIECE_METADATA>>>'

const pieceDir = process.argv[2]
const entry = process.argv[3]

const fail = (code, message) => {
    process.stdout.write(`${SENTINEL}\n${JSON.stringify({ error: message })}\n`)
    process.exit(code)
}

if (!pieceDir || !entry) {
    fail(2, 'usage: regen-piece-metadata-worker.mjs <piece-dir> <entry-file>')
}

let module = null
try {
    // Anchor module resolution at the piece package root: raw tsc dists require
    // their runtime deps from the piece's own package first, then the repo root.
    const requireFromPiece = createRequire(path.join(pieceDir, 'package.json'))
    module = requireFromPiece(entry)
} catch (error) {
    fail(4, `dist not loadable: ${error && error.message ? error.message : String(error)}`)
}

const piece = Object.values(module).find((exported) => exported?.metadata && exported?.displayName)
if (!piece) {
    fail(3, 'no Piece export')
}

const metadata = piece.metadata()
// Same serialization the in-process path uses: JSON round-trip drops functions
// (run handlers, dropdown options) and keeps the props schema records. The
// shape matches the parent's buildEntry contract: piece-level fields at the
// top level plus actions/triggers records.
const serialized = JSON.parse(JSON.stringify({
    displayName: metadata.displayName,
    logoUrl: metadata.logoUrl,
    description: metadata.description,
    categories: metadata.categories,
    authors: metadata.authors,
    auth: metadata.auth,
    minimumSupportedRelease: metadata.minimumSupportedRelease,
    maximumSupportedRelease: metadata.maximumSupportedRelease,
    actions: metadata.actions ?? {},
    triggers: metadata.triggers ?? {},
}))

process.stdout.write(`${SENTINEL}\n${JSON.stringify(serialized)}\n`)
