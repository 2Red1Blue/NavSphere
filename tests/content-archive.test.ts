import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import {
  ARCHIVE_COLUMNS,
  ARCHIVE_POINTER_COLUMNS,
  MAX_ARCHIVE_BODY_BYTES,
  archivePointer,
  archiveSnapshotGuard,
  makeArchiveObject,
  readArchiveBody,
  readArchiveObject,
  sameArchiveSnapshot,
  sha256Body,
  writeArchiveObject,
  type ArchiveKV,
  type ArchiveRow,
} from '../src/lib/content-archive'
import { createSqliteD1 } from './helpers/sqlite-d1'

function row(overrides: Partial<ArchiveRow> = {}): ArchiveRow {
  return {
    url_hash: '0123456789abcdef', url: 'https://example.com/source', source: 'fixture',
    original_url: null, original_url_provenance: null, discovered_at: '2026-01-01T00:00:00Z',
    content: '# 标题\r\n\n😀 Exact bytes\u0000\t\n', content_hash: null, content_version: 0,
    content_format: null, content_quality: 'legacy_unverified', content_chars: 10,
    content_quality_score: 0, content_extracted_at: null, content_source: null,
    approved_for_publication: 0, fulltext_publication_allowed: 0,
    fulltext_revoked_at: null, fulltext_control_version: 0,
    content_archive_key: null, content_archive_sha256: null, content_archive_version: null,
    content_archive_bytes: null, content_archived_at: null, ...overrides,
  }
}

async function archived(overrides: Partial<ArchiveRow> = {}) {
  const original = row(overrides)
  const object = await makeArchiveObject(original)
  const pointer = {
    ...original, content: null, content_archive_key: object.key,
    content_archive_sha256: object.sha256, content_archive_version: original.content_version,
    content_archive_bytes: object.bytes, content_archived_at: '2026-09-04T00:00:00.000Z',
  }
  const kv: ArchiveKV = { get: async () => object.value, put: async () => undefined }
  return { original, object, pointer, kv }
}

test('archive envelope is deterministic, preserves UTF-8 bytes and never changes editorial state', async () => {
  const { original, object, pointer, kv } = await archived()
  assert.deepEqual(await makeArchiveObject(original), object)
  assert.equal(object.bytes, Buffer.byteLength(original.content!))
  assert.equal(object.sha256, createHash('sha256').update(original.content!).digest('hex'))
  assert.equal(object.key, `feed-body/v1/${original.url_hash}/0/${object.sha256}`)
  assert.equal(await readArchiveBody(kv, pointer), original.content)
  assert.equal(original.content_hash, null)
  assert.equal(original.content_quality, 'legacy_unverified')
  assert.deepEqual(JSON.parse(object.value), {
    schema: 1, id: original.url_hash, version: 0, format: null,
    body: original.content, sha256: object.sha256, bytes: object.bytes,
  })
  assert.equal(await sha256Body('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('archive pointer requires every field, exact immutable key and current version', async () => {
  const { pointer } = await archived()
  assert.equal(archivePointer(pointer), true)
  for (const field of ARCHIVE_POINTER_COLUMNS) assert.equal(archivePointer({ ...pointer, [field]: null }), false, field)
  for (const changed of [
    { content_archive_key: '../private' }, { content_archive_sha256: 'A'.repeat(64) },
    { content_archive_version: 1 }, { content_archive_bytes: -1 }, { content_archive_bytes: 0 },
    { content_archive_bytes: MAX_ARCHIVE_BODY_BYTES + 1 }, { content_archive_bytes: 0.5 },
    { content_archived_at: '2026-02-30T00:00:00Z' }, { content_archived_at: 'yesterday' },
    { content_archived_at: '2026-09-04T00:00:00Zjunk' }, { url_hash: 'different-id' },
  ]) assert.equal(archivePointer({ ...pointer, ...changed }), false, JSON.stringify(changed))
})

test('missing, malformed and corrupt objects fail closed without leaking raw storage errors', async () => {
  const { object, pointer } = await archived({ content_format: 'markdown_v1' })
  const envelope = JSON.parse(object.value)
  const invalidValues: Array<string | null> = [null, 'SECRET-RAW', '{}', 'null', '[]',
    ...[
      { schema: 2 }, { id: 'fedcba9876543210' }, { version: 1 }, { format: null },
      { body: 'tampered' }, { sha256: '0'.repeat(64) }, { bytes: 0 }, { body: 42 },
      { unexpected: 'SECRET-RAW' },
    ].map((changed) => JSON.stringify({ ...envelope, ...changed })),
  ]
  for (const value of invalidValues) {
    await assert.rejects(readArchiveBody({ get: async () => value, put: async () => undefined }, pointer), /^Error: ARCHIVE_(MISSING|INVALID_OBJECT|INTEGRITY)$/)
  }
  await assert.rejects(readArchiveBody(undefined, pointer), /^Error: ARCHIVE_UNAVAILABLE$/)
  await assert.rejects(readArchiveBody({ get: async () => { throw new Error('SECRET-RAW') }, put: async () => undefined }, pointer), /^Error: ARCHIVE_UNAVAILABLE$/)
  let reads = 0
  await assert.rejects(readArchiveBody({ get: async () => { reads += 1; return object.value }, put: async () => undefined }, row()), /^Error: ARCHIVE_INVALID_POINTER$/)
  assert.equal(reads, 0)
})

test('UTF-8 size, valid Unicode and envelope sizes are bounded independently', async () => {
  await assert.rejects(makeArchiveObject(row({ content: null })), /^Error: ARCHIVE_INVALID_BODY$/)
  await assert.rejects(makeArchiveObject(row({ content: '\ud800' })), /^Error: ARCHIVE_INVALID_BODY$/)
  await assert.rejects(makeArchiveObject(row({ content: '中'.repeat(266_667) })), /^Error: ARCHIVE_TOO_LARGE$/)
  const { original, pointer, kv } = await archived({ content: 'x'.repeat(MAX_ARCHIVE_BODY_BYTES) })
  assert.equal(await readArchiveBody(kv, pointer), original.content)
  await assert.rejects(readArchiveBody({ get: async () => 'x'.repeat(MAX_ARCHIVE_BODY_BYTES * 6 + 2_049), put: async () => undefined }, pointer), /^Error: ARCHIVE_TOO_LARGE$/)
  await assert.rejects(makeArchiveObject(row({ content: '' })), /^Error: ARCHIVE_INVALID_BODY$/)
  const bom = await archived({ content: '\ufeff# Byte order mark retained' })
  assert.equal(await readArchiveBody(bom.kv, bom.pointer), bom.original.content)
})

test('archive read and write helpers are bounded and sanitize storage failures', async () => {
  const { object } = await archived()
  let captured: unknown
  const kv: ArchiveKV = { get: async () => null, put: async (...args) => { captured = args } }
  assert.equal(await readArchiveObject(kv, object.key), null)
  await writeArchiveObject(kv, object.key, object.value)
  assert.deepEqual(captured, [object.key, object.value])
  await assert.rejects(writeArchiveObject({ ...kv, put: async () => { throw new Error('SECRET') } }, object.key, object.value), /^Error: ARCHIVE_UNAVAILABLE$/)
  await assert.rejects(readArchiveObject(kv, 'SECRET'), /^Error: ARCHIVE_INVALID_KEY$/)
  const hanging: ArchiveKV = { get: async () => new Promise(() => undefined), put: async () => new Promise(() => undefined) }
  const started = Date.now()
  await Promise.all([
    assert.rejects(readArchiveObject(hanging, object.key), /^Error: ARCHIVE_TIMEOUT$/),
    assert.rejects(writeArchiveObject(hanging, object.key, object.value), /^Error: ARCHIVE_TIMEOUT$/),
  ])
  assert.ok(Date.now() - started < 6_500)
})

test('every archived snapshot field participates in null-safe comparisons', () => {
  const original = row()
  assert.deepEqual(new Set(ARCHIVE_COLUMNS), new Set(Object.keys(original)))
  assert.equal(sameArchiveSnapshot(original, { ...original }), true)
  for (const field of ARCHIVE_COLUMNS) {
    const value = original[field]
    const changed = value === null ? 'changed' : typeof value === 'number' ? value + 1 : `${value} changed`
    assert.equal(sameArchiveSnapshot(original, { ...original, [field]: changed }), false, field)
  }
  const guard = archiveSnapshotGuard(original, 3)
  assert.deepEqual(guard.values, ARCHIVE_COLUMNS.map((field) => original[field]))
  assert.match(guard.sql, /"url_hash" IS \?3/)
  assert.throws(() => archiveSnapshotGuard(original, 0), /ARCHIVE_INVALID_SNAPSHOT/)
  assert.throws(() => archiveSnapshotGuard({ ...original, content: undefined } as unknown as ArchiveRow), /ARCHIVE_INVALID_SNAPSHOT/)
})

test('real SQLite snapshot guards match NULLs and reject changed body or control revisions', async () => {
  const original = row()
  const fixture = createSqliteD1(`CREATE TABLE articles (${ARCHIVE_COLUMNS.map((field) => `"${field}" ${typeof original[field] === 'number' || ['content_archive_version', 'content_archive_bytes'].includes(field) ? 'INTEGER' : 'TEXT'}`).join(',')});`)
  try {
    await fixture.db.prepare(`INSERT INTO articles (${ARCHIVE_COLUMNS.join(',')}) VALUES (${ARCHIVE_COLUMNS.map(() => '?').join(',')})`).bind(...ARCHIVE_COLUMNS.map((field) => original[field])).run()
    const guard = archiveSnapshotGuard(original, 2)
    const statement = fixture.db.prepare(`UPDATE articles SET content = ?1 WHERE ${guard.sql}`)
    assert.equal((await statement.bind('replacement', ...guard.values).run()).meta.changes, 1)
    assert.equal((await statement.bind('stale replacement', ...guard.values).run()).meta.changes, 0)
    const current = fixture.query<ArchiveRow>('SELECT * FROM articles')[0]
    fixture.exec('UPDATE articles SET fulltext_control_version = fulltext_control_version + 1')
    const stale = archiveSnapshotGuard(current)
    assert.equal((await fixture.db.prepare(`UPDATE articles SET content = NULL WHERE ${stale.sql}`).bind(...stale.values).run()).meta.changes, 0)
  } finally { fixture.close() }
})

test('SQLite D1 bindings retain TEXT including quotes, JSON, newlines, NUL and SQL-like payloads', async () => {
  const fixture = createSqliteD1('CREATE TABLE fixture(id INTEGER PRIMARY KEY, value TEXT, optional TEXT)')
  const values = ['123', "x'); DROP TABLE fixture; --", '.quit\nline', '中文😀', '{"value":"quoted"}', '', 'NULL', '1e2']
  try {
    for (let index = 0; index < values.length; index += 1) {
      const result = await fixture.db.prepare('INSERT INTO fixture(id, value, optional) VALUES (?1, ?2, ?3)').bind(index, values[index], null).run()
      assert.equal(result.meta.changes, 1)
    }
    assert.deepEqual((await fixture.db.prepare('SELECT value FROM fixture ORDER BY id').all<{ value: string }>()).results.map(({ value }) => value), values)
    assert.equal(await fixture.db.prepare('SELECT typeof(value) AS kind FROM fixture WHERE id = ?').bind(0).first('kind'), 'text')
    assert.equal(await fixture.db.prepare('SELECT value FROM fixture WHERE id = ?').bind(999).first(), null)
    assert.equal((await fixture.db.prepare('UPDATE fixture SET value = ? WHERE id = ?').bind('absent', 999).run()).meta.changes, 0)
    assert.deepEqual(await fixture.db.prepare('SELECT value, optional FROM fixture WHERE id = ?').bind(0).raw(), [['123', null]])
    assert.equal(fixture.query<{ literal: string; value: string }>("SELECT '?1' AS literal, ?1 AS value -- ?2", ['bound'])[0].value, 'bound')
    // The CLI's own JSON output truncates embedded NULs. SQLite JSON functions
    // escape them correctly, proving the bound TEXT itself retained every byte.
    const nul = '中文😀\u0000end'
    const stored = fixture.query<{ encoded: string; hexadecimal: string }>('SELECT json_quote(?1) AS encoded, hex(?1) AS hexadecimal', [nul])[0]
    assert.equal(JSON.parse(stored.encoded), nul)
    assert.equal(stored.hexadecimal, Buffer.from(nul).toString('hex').toUpperCase())
  } finally { fixture.close() }
})

test('SQLite adapter enforces foreign keys, D1 GLOB50, atomic batches and actual trigger changes', async () => {
  const fixture = createSqliteD1(`
    CREATE TABLE parent(id INTEGER PRIMARY KEY, value INTEGER DEFAULT 0);
    CREATE TABLE child(parent_id INTEGER REFERENCES parent(id));
    CREATE TRIGGER revision AFTER UPDATE OF value ON parent BEGIN UPDATE parent SET value = NEW.value + 1 WHERE id = NEW.id; END;
  `)
  try {
    await assert.rejects(fixture.db.prepare('INSERT INTO child VALUES (1)').run(), /FOREIGN KEY/)
    await assert.rejects(fixture.db.prepare('SELECT ? GLOB ?').bind('x', 'x'.repeat(51)).all(), /pattern too complex/)
    await assert.rejects(fixture.db.batch([
      fixture.db.prepare('INSERT INTO parent(id) VALUES (?)').bind(1),
      fixture.db.prepare('INSERT INTO child VALUES (?)').bind(2),
    ]))
    assert.equal(fixture.query('SELECT * FROM parent').length, 0)
    const batch = await fixture.db.batch([
      fixture.db.prepare('INSERT INTO parent(id) VALUES (?)').bind(1),
      fixture.db.prepare('UPDATE parent SET value = ? WHERE id = ?').bind(10, 1),
    ])
    assert.deepEqual(batch.map((result) => result.meta.changes), [1, 2])
    assert.equal(fixture.query<{ value: number }>('SELECT value FROM parent')[0].value, 11)
    const updated = await fixture.db.prepare('UPDATE parent SET value = ? WHERE id = ?').bind(20, 1).run()
    assert.equal(updated.meta.changes, 2, 'D1 includes the additional trigger update')
    const selected = await fixture.db.prepare('SELECT value FROM parent WHERE id = ?').bind(1).all<{ value: number }>()
    assert.deepEqual(selected.results, [{ value: 21 }])
    assert.equal(selected.meta.changes, 0, 'SELECT excludes prior writes and parameter bindings')
  } finally { fixture.close() }
})
