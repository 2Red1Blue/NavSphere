import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const scanner = new URL('../scripts/artifact-scan.mjs', import.meta.url)

test('artifact scanner rejects a forbidden marker in an oversized extensionless chunk', () => {
  const directory = mkdtempSync(join(tmpdir(), 'navsphere-artifact-scan-'))
  try {
    mkdirSync(join(directory, 'static'))
    writeFileSync(join(directory, 'static', 'large'), `${'x'.repeat(2 * 1024 * 1024)}mock_v2`)
    const result = spawnSync(process.execPath, [scanner.pathname, directory], { encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /large: "mock_v2"/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('artifact scanner reports a missing output directory without a raw stack trace', () => {
  const directory = join(tmpdir(), `navsphere-artifact-missing-${process.pid}`)
  const result = spawnSync(process.execPath, [scanner.pathname, directory], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /output directory is unavailable/)
})
