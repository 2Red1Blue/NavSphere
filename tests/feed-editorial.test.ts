import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { canonicalEditorialJson } from '../src/lib/editorial-contract'
import { handleEditorialRequest, readEditorialRequestBody } from '../src/lib/feed-editorial-http'
import { createSqliteD1, type SqliteD1Fixture } from './helpers/sqlite-d1'

const articleId = '0123456789abcdef'
const source = { url: 'https://aihot.virxact.com/p/one', original_url: null, original_url_provenance: null }
const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
function bundle(expected_state = 'absent', expected_revision = 0, action = 'publish') {
  const claim = (text: string) => ({ text, evidence_ids: ['E1'] })
  const brief = {
    headline: claim('作者发布一项新的研究'), lead: claim('据作者介绍，本次研究展示了一个早期原型，目前仍需更多测试才能验证适用范围。'),
    facts: [claim('作者提供的材料展示了当前原型的运行方式。'), claim('该材料没有提供第三方独立验证的测试结果。')],
    analysis: claim('这些信息有助于了解方向，但尚不足以判断长期影响。'), caveats: ['该结果仍然需要进一步独立验证。'],
  }
  const publication = {
    schema_version: 1, renderer_version: 'editorial-v1', article_id: articleId, source,
    packet_sha256: '1'.repeat(64), evidence: [{ id: 'E1', label: '作者材料', url: 'https://example.com/research', kind: 'primary', text_sha256: '2'.repeat(64) }], brief,
  }
  const entries = [
    { path: 'headline', text: brief.headline.text, decision: 'supported' },
    { path: 'lead', text: brief.lead.text, decision: 'qualified' },
    ...brief.facts.map((fact, index) => ({ path: `facts.${index}`, text: fact.text, decision: 'supported' })),
    { path: 'analysis', text: brief.analysis.text, decision: 'interpretation' },
    { path: 'caveats.0', text: brief.caveats[0], decision: 'limitation' },
  ]
  const manifest = { schema_version: 1, publication, action, expected_state, expected_revision,
    review: { version: 'editorial-review-v1', decisions: entries.map(({ path, text, decision }) => ({ path, text_sha256: hash(text), evidence_ids: ['E1'], decision, note: '已逐条核对材料。' })) } }
  return { manifest, attestation: { schema_version: 1, manifest_sha256: hash(canonicalEditorialJson(manifest)), reviewer: '测试审核人', attested_at: '2026-09-04T00:00:00Z', statement: 'reviewed-for-independent-editorial-publication-v1' } }
}

function fixture() {
  const fixture = createSqliteD1(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'))
  fixture.query(`INSERT INTO articles(url_hash,title,source,url,discovered_at,approved_for_publication,score,signal,novelty,usefulness,content)
    VALUES (?, 'Original title', 'aihot', ?, '2026-09-04T00:00:00Z', 1, 24, 8, 9, 7, ?)`, [articleId, source.url, 'Unapproved original body\u0000must remain exact'])
  return fixture
}

function request(fixture: SqliteD1Fixture, body?: unknown, options: {
  enabled?: string; id?: string; paramId?: string; pathname?: string; method?: string; suffix?: string; token?: string
} = {}) {
  const pathname = options.pathname ?? `/api/feed/${options.id ?? articleId}/editorial`
  const req = new Request(`https://local.example${pathname}${options.suffix ?? ''}`, {
    method: options.method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { Authorization: `Bearer ${options.token ?? 'test-secret'}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return handleEditorialRequest(req, options.paramId ?? options.id ?? articleId, () => ({ DB: fixture.db, CONTENT_OS_API_KEY: 'test-secret', FEED_EDITORIAL_ENABLED: options.enabled ?? 'true' }))
}

test('editorial CAS lifecycle uses exact receipts and never mutates original article bytes or rights', async () => {
  const f = fixture()
  try {
    const before = f.query('SELECT *, hex(content) AS content_bytes FROM articles')
    const initial = await (await request(f)).json()
    assert.equal(initial.state, 'absent'); assert.equal(initial.revision, 0)
    const first = await request(f, bundle())
    assert.equal(first.status, 200)
    assert.deepEqual(await first.json(), { article_id: articleId, state: 'published', revision: 1, manifest_sha256: bundle().attestation.manifest_sha256, approval_digest: hash(canonicalEditorialJson(bundle())) })
    assert.equal((await request(f, bundle())).status, 409)
    const state = await (await request(f)).json()
    assert.deepEqual(Object.keys(state).sort(), ['approval_digest', 'article_global_approved', 'article_id', 'manifest_sha256', 'revision', 'source', 'state'])
    assert.equal((await request(f, { action: 'revoke', expected_state: 'published', expected_revision: 1, reason: '重新核对来源。' })).status, 200)
    assert.equal((await request(f, bundle('withdrawn', 2))).status, 400)
    assert.equal((await request(f, bundle('withdrawn', 2, 'restore'))).status, 200)
    assert.deepEqual(f.query('SELECT *, hex(content) AS content_bytes FROM articles'), before)
  } finally { f.close() }
})

test('absent revoke tombstone defeats in-flight first publication and repeated revokes advance revision', async () => {
  const f = fixture()
  try {
    assert.equal((await request(f, { action: 'revoke', expected_state: 'absent', expected_revision: 0, reason: '需要重新审查。' })).status, 200)
    assert.equal((await request(f, bundle())).status, 409)
    assert.equal((await request(f, { action: 'revoke', expected_state: 'withdrawn', expected_revision: 1, reason: '继续撤回。' })).status, 200)
    assert.equal((await request(f, bundle('withdrawn', 1, 'restore'))).status, 409)
    f.query('UPDATE articles SET approved_for_publication=0 WHERE url_hash=?', [articleId])
    assert.equal((await request(f, bundle('withdrawn', 2, 'restore'))).status, 409)
    assert.equal((await request(f, { action: 'revoke', expected_state: 'withdrawn', expected_revision: 2, reason: '全局撤回不妨碍此操作。' })).status, 200)
  } finally { f.close() }
})

test('source identity and global approval are guarded in mutation SQL, not only preflight', async () => {
  for (const sql of ['UPDATE articles SET url=url || \'?changed=1\'', 'UPDATE articles SET approved_for_publication=0']) {
    const f = fixture()
    try {
      const db = f.db
      f.db = { ...db, prepare(query: string) {
        if (/INSERT INTO article_editorials/.test(query)) f.exec(sql)
        return db.prepare(query)
      } }
      assert.equal((await request(f, bundle())).status, 409)
      assert.equal(f.query('SELECT * FROM article_editorials').length, 0)
    } finally { f.close() }
  }
})

test('editorial HTTP denies auth, disabled writes, queries, malformed IDs and unknown fields without writes', async () => {
  const f = fixture()
  try {
    assert.equal((await request(f, bundle(), { token: 'wrong' })).status, 401)
    assert.equal((await request(f, bundle(), { enabled: 'false' })).status, 409)
    assert.equal((await request(f, bundle(), { suffix: '?id=other' })).status, 400)
    assert.equal((await request(f, bundle(), { id: articleId.toUpperCase() })).status, 400)
    assert.equal((await request(f, bundle(), { id: 'fedcba9876543210' })).status, 404)
    assert.equal((await request(f, { ...bundle(), approved_for_publication: true })).status, 400)
    assert.equal((await request(f, undefined, { method: 'DELETE' })).status, 400)
    assert.equal((await request(f)).headers.get('Cache-Control'), 'no-store')
    assert.equal(f.query('SELECT * FROM article_editorials').length, 0)
  } finally { f.close() }
})

test('editorial HTTP accepts the sole decoded adapter ID without changing approval digests or original bytes', async () => {
  for (const suffix of ['', `?id=${articleId}`, `?%69d=${articleId}`, `?id=%30${articleId.slice(1)}`]) {
    const f = fixture()
    try {
      const before = f.query('SELECT *, hex(content) AS content_bytes FROM articles')
      const initial = await request(f, undefined, { suffix })
      assert.equal(initial.status, 200, suffix)
      assert.equal((await initial.json()).article_id, articleId)
      const publication = await request(f, bundle(), { suffix })
      assert.equal(publication.status, 200, suffix)
      assert.deepEqual(await publication.json(), {
        article_id: articleId, state: 'published', revision: 1,
        manifest_sha256: bundle().attestation.manifest_sha256, approval_digest: hash(canonicalEditorialJson(bundle())),
      })
      assert.deepEqual(f.query('SELECT *, hex(content) AS content_bytes FROM articles'), before)
    } finally { f.close() }
  }
})

test('editorial HTTP binds actual pathname independently of params and decoded query entries', async () => {
  const f = fixture()
  const otherId = 'fedcba9876543210'
  const path = `/api/feed/${articleId}/editorial`
  try {
    for (const options of [
      { paramId: otherId }, { pathname: `/api/feed/${otherId}/editorial` },
      { paramId: otherId, suffix: `?id=${otherId}` },
      { pathname: `/api/feed/${otherId}/editorial`, suffix: `?id=${articleId}` },
      { paramId: 'invalid' }, { paramId: `${articleId}\n` },
      { pathname: '/api/feed/[id]/editorial', suffix: `?id=${articleId}` },
      { pathname: `${path}/` }, { pathname: `${path}.rsc` }, { pathname: '/editorial' },
      { pathname: `/api/feed/%30${articleId.slice(1)}/editorial` },
      { suffix: `?id=${articleId}&id=${articleId}` },
      { suffix: `?id=${articleId}&%69d=${articleId}` },
      { suffix: `?id=${articleId}&other=1` }, { suffix: '?other=1' },
      { suffix: `?nxtPid=${articleId}` }, { suffix: '?_rsc=test' },
      { suffix: '?id=' }, { suffix: `?ID=${articleId}` }, { suffix: '?&&' },
    ]) {
      for (const body of [undefined, bundle()]) {
        const response = await request(f, body, options)
        assert.equal(response.status, 400, JSON.stringify(options))
        assert.deepEqual(await response.json(), { code: 'INVALID_REQUEST' })
        assert.equal(response.headers.get('Cache-Control'), 'no-store')
      }
    }
    assert.equal(f.query('SELECT * FROM article_editorials').length, 0)
  } finally { f.close() }
})

test('editorial HTTP rejects URL confusion before body or DB, while authentication stays first', async () => {
  let accesses = 0
  const env = { DB: { prepare() { accesses++; throw new Error('private db details') } }, CONTENT_OS_API_KEY: 'test-secret' } as unknown as CloudflareEnv
  const path = `/api/feed/${articleId}/editorial`
  for (const [suffix, token, expected] of [
    ['?other=1', 'wrong', 401], ['?other=1', 'test-secret', 400],
    [`?id=${articleId}`, 'test-secret', 409], ['', 'test-secret', 409],
  ] as const) {
    const req = new Request(`https://local.example${path}${suffix}`, {
      method: 'POST', body: 'not JSON', headers: { Authorization: `Bearer ${token}` },
    })
    const response = await handleEditorialRequest(req, articleId, () => env)
    assert.equal(response.status, expected)
    assert.equal(req.bodyUsed, false)
  }
  const malformed = new Request(`https://local.example${path}`, { headers: { Authorization: 'Bearer test-secret' } })
  // A Request normally guarantees a valid URL; retain a total adapter predicate.
  Object.defineProperty(malformed, 'url', { value: 'not a URL' })
  assert.equal((await handleEditorialRequest(malformed, articleId, () => env)).status, 400)
  assert.equal(accesses, 0)
})

test('editorial HTTP bounds streamed bytes before parse and rejects duplicate keys and malformed UTF-8', async () => {
  const f = fixture()
  try {
    const send = (body: BodyInit, headers: Record<string, string> = {}) => handleEditorialRequest(new Request(`https://local.example/api/feed/${articleId}/editorial`, {
      method: 'POST', body, headers: { Authorization: 'Bearer test-secret', 'Content-Type': 'application/json', ...headers },
      // Node requires duplex for a synthetic stream; the edge handler uses standard Request.
      duplex: 'half',
    } as RequestInit), articleId, () => ({ DB: f.db, CONTENT_OS_API_KEY: 'test-secret', FEED_EDITORIAL_ENABLED: 'true' }))
    let cancelled = false
    let chunks = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { chunks++; controller.enqueue(new Uint8Array(16 * 1024).fill(32)) },
      cancel() { cancelled = true },
    })
    assert.equal((await send(stream, { 'Content-Length': '1' })).status, 413)
    assert.equal(cancelled, true)
    assert(chunks <= 5)
    assert.equal((await send('{}', { 'Content-Length': String(48 * 1024 + 1) })).status, 413)
    assert.equal((await send(new Uint8Array([0xc3, 0x28]))).status, 400)
    assert.equal((await send('{"action":"revoke","action":"publish"}')).status, 400)
    assert.equal((await send('{}', { 'Content-Type': 'text/plain' })).status, 400)
    assert.equal((await send('{}', { 'Content-Encoding': 'gzip' })).status, 400)
    assert.equal(f.query('SELECT * FROM article_editorials').length, 0)
  } finally { f.close() }
})

test('editorial HTTP authenticates and defaults off before body consumption or database access', async () => {
  let accesses = 0
  const env = { DB: { prepare() { accesses++; throw new Error('private db details') } }, CONTENT_OS_API_KEY: 'test-secret' } as unknown as CloudflareEnv
  const req = (auth: string) => new Request(`https://local.example/api/feed/${articleId}/editorial`, { method: 'POST', body: 'not JSON', headers: { Authorization: auth } })
  assert.equal((await handleEditorialRequest(req('Bearer wrong'), articleId, () => env)).status, 401)
  assert.equal((await handleEditorialRequest(req('Bearer test-secret'), articleId, () => env)).status, 409)
  assert.equal(accesses, 0)
  const failed = await handleEditorialRequest(new Request(`https://local.example/api/feed/${articleId}/editorial`, { headers: { Authorization: 'Bearer test-secret' } }), articleId, () => env)
  assert.equal(failed.status, 503)
  assert.doesNotMatch(await failed.text(), /private db details|test-secret/)
  assert.equal(failed.headers.get('Cache-Control'), 'no-store')
})

test('editorial body deadline cancels a blocked stream without reading an unbounded request', async () => {
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('null')) },
    cancel() { cancelled = true },
  })
  const request = new Request('https://local.example/editorial', { method: 'POST', body, duplex: 'half' } as RequestInit)
  await assert.rejects(readEditorialRequestBody(request, 10), { name: 'EditorialValidationError', message: 'Invalid editorial request' })
  assert.equal(cancelled, true)
})

test('editorial update and restore CAS reject concurrent source changes and same-second repeated revoke', async () => {
  const f = fixture()
  try {
    const db = f.db
    f.db = { ...db, prepare(sql: string) { return db.prepare(sql.replaceAll("strftime('%Y-%m-%dT%H:%M:%SZ', 'now')", "'2026-09-04T00:00:00Z'")) } }
    assert.equal((await request(f, bundle())).status, 200)
    assert.equal((await request(f, bundle('published', 1))).status, 200)
    assert.equal((await request(f, { action: 'revoke', expected_state: 'published', expected_revision: 2, reason: '第一次撤回。' })).status, 200)
    const firstDate = f.query<{ withdrawn_at: string }>('SELECT withdrawn_at FROM article_editorials')[0].withdrawn_at
    assert.equal((await request(f, { action: 'revoke', expected_state: 'withdrawn', expected_revision: 3, reason: '第二次撤回。' })).status, 200)
    assert.equal(f.query<{ withdrawn_at: string }>('SELECT withdrawn_at FROM article_editorials')[0].withdrawn_at, firstDate)
    assert.equal((await request(f, bundle('withdrawn', 3, 'restore'))).status, 409)
    f.db = { ...db, prepare(sql: string) {
      if (/UPDATE article_editorials/.test(sql)) f.exec("UPDATE articles SET original_url='https://example.com/new-source', original_url_provenance='aihot_api_v1'")
      return db.prepare(sql)
    } }
    assert.equal((await request(f, bundle('withdrawn', 4, 'restore'))).status, 409)
    assert.equal(f.query<{ revision: number }>('SELECT revision FROM article_editorials')[0].revision, 4)
  } finally { f.close() }
})

test('editorial mutations use RETURNING despite trigger-inclusive changes and reject zero-row receipts', async () => {
  const f = fixture()
  try {
    f.exec('CREATE TABLE editorial_test_audit(revision INTEGER); CREATE TRIGGER editorial_test_insert AFTER INSERT ON article_editorials BEGIN INSERT INTO editorial_test_audit VALUES(NEW.revision); END;')
    assert.equal((await request(f, bundle())).status, 200)
    assert.equal(f.query('SELECT * FROM editorial_test_audit').length, 1)
    const db = f.db
    f.db = { ...db, prepare(sql: string) {
      const statement = db.prepare(sql)
      if (!/UPDATE article_editorials/.test(sql)) return statement
      return { ...statement, bind() { return this }, async all() { return { success: true, results: [], meta: { changes: 999 } } } } as unknown as D1PreparedStatement
    } }
    assert.equal((await request(f, bundle('published', 1))).status, 409)
    assert.equal(f.query<{ revision: number }>('SELECT revision FROM article_editorials')[0].revision, 1)
  } finally { f.close() }
})

function editorialMigrationSources() {
  const directory = new URL('../migrations/', import.meta.url)
  const migrationNames = readdirSync(directory).filter(name => /^\d+.*\.sql$/.test(name)).sort()
  const previous = migrationNames.filter(name => Number(name.slice(0, 3)) < 10).map(name => readFileSync(new URL(name, directory), 'utf8')).join('\n')
  const migration = readFileSync(new URL('010-add-article-editorials.sql', directory), 'utf8')
  return { previous, migration }
}

test('editorial schema upgrades version9 and rejects duplicate direct apply without changing data', () => {
  const { previous, migration } = editorialMigrationSources()
  const upgraded = createSqliteD1(previous)
  const snapshot = fixture()
  try {
    upgraded.exec(`INSERT INTO articles(url_hash,title,source,url,discovered_at,approved_for_publication,content)
      VALUES('${articleId}','Legacy article','aihot','${source.url}','2026-09-04T00:00:00Z',0,'legacy body');`)
    const before = upgraded.query('SELECT * FROM articles')
    upgraded.exec(migration)
    assert.deepEqual(upgraded.query('SELECT * FROM articles'), before)
    assert.deepEqual(upgraded.query('PRAGMA table_info(article_editorials)'), snapshot.query('PRAGMA table_info(article_editorials)'))
    assert.deepEqual(upgraded.query('PRAGMA foreign_key_list(article_editorials)'), snapshot.query('PRAGMA foreign_key_list(article_editorials)'))
    assert.equal(upgraded.query<{ version: number }>('SELECT MAX(version) AS version FROM schema_migrations')[0].version, 10)
    assert.equal(upgraded.query<{ count: number }>("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='index' AND tbl_name='article_editorials'")[0].count, 1)
    upgraded.exec(`INSERT INTO article_editorials(url_hash,revision,state,withdrawn_at,withdrawal_reason)
      VALUES('${articleId}',1,'withdrawn','2026-09-04T00:00:00Z','需要审查');`)
    const editorialBefore = upgraded.query('SELECT * FROM article_editorials')
    const ledgerBefore = upgraded.query('SELECT * FROM schema_migrations ORDER BY version')
    assert.throws(() => upgraded.exec(migration), /table article_editorials already exists/)
    assert.deepEqual(upgraded.query('SELECT * FROM articles'), before)
    assert.deepEqual(upgraded.query('SELECT * FROM article_editorials'), editorialBefore)
    assert.deepEqual(upgraded.query('SELECT * FROM schema_migrations ORDER BY version'), ledgerBefore)
    assert.throws(() => upgraded.exec(`DELETE FROM articles WHERE url_hash='${articleId}'`), /FOREIGN KEY/)
    for (const assignment of ["revision=0", "revision=1.5", "revision=2147483648", "state='absent'", "state='published'", "publication_json='not json'", "manifest_sha256='BAD'", "withdrawal_reason=NULL"]) {
      assert.throws(() => upgraded.exec(`UPDATE article_editorials SET ${assignment} WHERE url_hash='${articleId}'`))
    }
    assert.throws(() => upgraded.query('UPDATE article_editorials SET withdrawal_reason=?', ['x\u0000' + 'a'.repeat(1000)]))
    assert.throws(() => upgraded.query('UPDATE article_editorials SET withdrawn_at=?', ['2026-09-04T00:00:00Z\u0000extra']))
    assert.equal(upgraded.query<{ revision: number }>('SELECT revision FROM article_editorials')[0].revision, 1)
  } finally { upgraded.close(); snapshot.close() }
})

test('editorial schema rejects a same-column weak table before version10 bookkeeping and preserves old data', () => {
  const { previous, migration } = editorialMigrationSources()
  const existing = createSqliteD1(previous)
  const snapshot = fixture()
  try {
    existing.query(`INSERT INTO articles(url_hash,title,source,url,discovered_at,content)
      VALUES(?, 'Existing article', 'aihot', ?, '2026-09-04T00:00:00Z', ?)`,
    [articleId, source.url, 'Existing body\u0000must remain byte-exact'])
    // Same column names are not proof of the PK/FK/CHECK publication contract.
    existing.exec(`CREATE TABLE article_editorials (
      url_hash TEXT, revision INTEGER, state TEXT, publication_json TEXT,
      manifest_sha256 TEXT, approval_digest TEXT, review_sha256 TEXT,
      approved_by TEXT, approved_at TEXT, published_at TEXT, withdrawn_at TEXT, withdrawal_reason TEXT
    );`)
    existing.query('INSERT INTO article_editorials(url_hash,revision,state,publication_json) VALUES(?,?,?,?)',
      [articleId, -3, 'unreviewed', 'Existing draft\u0000must remain byte-exact'])
    assert.deepEqual(existing.query<{ name: string }>("SELECT name FROM pragma_table_info('article_editorials') ORDER BY cid"),
      snapshot.query<{ name: string }>("SELECT name FROM pragma_table_info('article_editorials') ORDER BY cid"))
    const articlesBefore = existing.query('SELECT *, hex(content) AS body_bytes FROM articles')
    const editorialBefore = existing.query('SELECT *, hex(publication_json) AS publication_bytes FROM article_editorials')
    const definitionBefore = existing.query("SELECT sql FROM sqlite_master WHERE name='article_editorials'")
    const ledgerBefore = existing.query('SELECT * FROM schema_migrations ORDER BY version')
    // The SQLite-D1 adapter executes with -bail: a first-statement error must
    // prevent the following schema_migrations INSERT, not merely report an error.
    assert.throws(() => existing.exec(migration), /table article_editorials already exists/)
    assert.deepEqual(existing.query('SELECT * FROM schema_migrations WHERE version=10'), [])
    assert.deepEqual(existing.query('SELECT * FROM schema_migrations ORDER BY version'), ledgerBefore)
    assert.deepEqual(existing.query("SELECT sql FROM sqlite_master WHERE name='article_editorials'"), definitionBefore)
    assert.deepEqual(existing.query('SELECT *, hex(content) AS body_bytes FROM articles'), articlesBefore)
    assert.deepEqual(existing.query('SELECT *, hex(publication_json) AS publication_bytes FROM article_editorials'), editorialBefore)
  } finally { existing.close(); snapshot.close() }
})
