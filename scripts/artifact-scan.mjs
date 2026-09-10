#!/usr/bin/env node
/**
 * Production artifact scan (audit recommendation #4, 2026-09-09).
 *
 * Scans the built Cloudflare Pages output for anything that must never reach
 * production:
 *  - 【占位】/ placeholder fixture content (mock articles)
 *  - references to the mock preview fixtures (__fixtures__/editorial-article)
 *  - the ?mock_v2= runtime branch marker (must be compiled out)
 *
 * Exit 1 (and block cf:deploy) on any hit.  Run from the NavSphere directory
 * after `next-on-pages` has produced .vercel/output/static.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const OUTPUT_DIR = process.argv[2] ?? '.vercel/output/static'
const BANNED = [
  '【占位】',
  'mock_v2',
  '__fixtures__/editorial-article',
  'editorial-article-mock',
  'MOCK_EDITORIAL_ARTICLE_V2_KEYS',
  'loadMockEditorialArticleV2',
]

if (!existsSync(OUTPUT_DIR) || !statSync(OUTPUT_DIR).isDirectory()) {
  console.error(`artifact-scan: FAILED — output directory is unavailable: ${OUTPUT_DIR}`)
  process.exit(1)
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) yield* walk(full)
    else yield full
  }
}

const hits = []
let scanned = 0
for (const path of walk(OUTPUT_DIR)) {
  // Output files are build artifacts under our control. Scan every byte so a
  // renamed or extensionless executable chunk cannot bypass the release gate.
  const content = readFileSync(path)
  scanned += 1
  for (const needle of BANNED) {
    if (content.includes(needle)) {
      hits.push({ file: relative(OUTPUT_DIR, path), needle })
    }
  }
}

console.log(`artifact-scan: scanned ${scanned} files in ${OUTPUT_DIR}`)
if (hits.length > 0) {
  console.error('artifact-scan: FAILED — banned content found:')
  for (const hit of hits) console.error(`  ${hit.file}: "${hit.needle}"`)
  process.exit(1)
}
console.log('artifact-scan: PASS — no mock/placeholder content in the production artifact')
