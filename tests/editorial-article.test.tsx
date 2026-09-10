import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'

import {
  EditorialArticle,
  EditorialArticleUnavailable,
  estimateReadingMinutes,
  parseEditorialArticleV2,
  resolveEditorialV2State,
} from '../src/components/feed/editorial-article'

const fixturesDir = join(__dirname, '../src/components/feed/__fixtures__')
const loadFixture = (name: string) =>
  JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as unknown

function fixturePublication(name = 'editorial-v2-explainer.mock.json') {
  return parseEditorialArticleV2(loadFixture(name))
}

test('parser accepts contract-shaped fixtures and rejects unknown versions', () => {
  const publication = fixturePublication()
  assert.ok(publication)
  assert.equal(publication.renderer_version, 'editorial-v2')
  assert.ok([...publication.article.title].length > 30)
  assert.ok(parseEditorialArticleV2(loadFixture('editorial-v2-brief.mock.json')))
  const unknown = parseEditorialArticleV2({
    ...(loadFixture('editorial-v2-brief.mock.json') as Record<string, unknown>),
    renderer_version: 'editorial-v9',
  })
  assert.equal(unknown, null)
  assert.equal(parseEditorialArticleV2(null), null)
})

test('list blocks accept items[] only, never the text-split shape', () => {
  const broken = parseEditorialArticleV2(loadFixture('editorial-v2-brief.mock.json'))
  assert.ok(broken)
  const bad = structuredClone(broken) as unknown as Record<string, unknown>
  const article = bad.article as Record<string, unknown>
  const sections = article.sections as Array<Record<string, unknown>>
  const blocks = sections[1].blocks as Array<Record<string, unknown>>
  const list = blocks[0] as Record<string, unknown>
  list.text = '【占位】不应存在的 text 拆分形态'
  delete list.items
  assert.equal(parseEditorialArticleV2(bad), null)
})

test('downgraded_from is only valid on a brief downgraded from explainer', () => {
  const brief = parseEditorialArticleV2(loadFixture('editorial-v2-brief.mock.json'))
  assert.ok(brief)
  assert.equal(brief.downgraded_from, 'explainer')
  const onExplainer = {
    ...(loadFixture('editorial-v2-explainer.mock.json') as Record<string, unknown>),
    downgraded_from: 'explainer',
  }
  assert.equal(parseEditorialArticleV2(onExplainer), null)
  const wrongValue = {
    ...(loadFixture('editorial-v2-brief.mock.json') as Record<string, unknown>),
    downgraded_from: 'feature',
  }
  assert.equal(parseEditorialArticleV2(wrongValue), null)
})

test('reader states follow CONTRACT.md §2.4 without v1 fallback for v2 records', () => {
  const available = resolveEditorialV2State(loadFixture('editorial-v2-explainer.mock.json'))
  assert.equal(available.state, 'available')
  // A v2 record that fails validation is unavailable, never absent/v1.
  const invalidV2 = {
    ...(loadFixture('editorial-v2-explainer.mock.json') as Record<string, unknown>),
    sources: [],
  }
  assert.equal(resolveEditorialV2State(invalidV2).state, 'unavailable')
  // Unknown renderer version on a v2 record: unavailable.
  const unknownVersion = {
    ...(loadFixture('editorial-v2-explainer.mock.json') as Record<string, unknown>),
    renderer_version: 'editorial-v9',
  }
  assert.equal(resolveEditorialV2State(unknownVersion).state, 'unavailable')
  // Unknown future schema: unavailable.
  assert.equal(resolveEditorialV2State({ schema_version: 3 }).state, 'unavailable')
  // v1 records and missing editorials defer to the v1 path (absent for v2).
  assert.equal(resolveEditorialV2State({ schema_version: 1 }).state, 'absent')
  assert.equal(resolveEditorialV2State(null).state, 'absent')
})

test('article renders reviewed title, pure contract anchors and collapsed sources', () => {
  const publication = fixturePublication()
  assert.ok(publication)
  const html = renderToStaticMarkup(createElement(EditorialArticle, {
    publication,
    publishedAt: '2026-09-08T00:00:00Z',
    sourceName: 'Psyche',
  }))
  assert.match(html, /不善待自己，也是一种道德过错吗/)
  assert.match(html, /原文解读/)
  assert.match(html, /预计阅读 \d+ 分钟/)
  assert.match(html, /\[1\]/)
  // Anchors are pure functions of contract ids with the fixed ed- prefix.
  assert.match(html, /id="ed-sec_01"/)
  assert.match(html, /id="ed-b_04"/)
  assert.doesNotMatch(html, /id="v2-sec-/)
  // Quote attribution renders inside the quote block.
  assert.match(html, /—— <cite[^>]*>关于自我免除悖论的讨论<\/cite>/)
  // Emphasis spans render as strong, never dropped silently.
  assert.match(html, /<strong>自我关系也受道德约束<\/strong>/)
  // original_title now comes from sources[] and stays in the bibliography line.
  assert.match(html, /原始标题（来源书目信息，非本站审定标题）：Is it morally wrong/)
  // TOC exists; sources stay collapsed by default.
  assert.match(html, /本篇目录/)
  assert.match(html, /相关来源（2）/)
  assert.doesNotMatch(html, /<details[^>]*\bopen[\s>]/)
})

test('brief renders the downgrade notice for downgraded_from=explainer', () => {
  const publication = fixturePublication('editorial-v2-brief.mock.json')
  assert.ok(publication)
  const html = renderToStaticMarkup(createElement(EditorialArticle, { publication }))
  assert.match(html, /简讯/)
  assert.match(html, /降级标识/)
  assert.match(html, /由「原文解读」路径因材料不足降级为简讯/)
})

test('unavailable state shows a notice with a source entry, never article content', () => {
  const html = renderToStaticMarkup(createElement(EditorialArticleUnavailable, {
    sourceLabel: 'Psyche',
    sourceUrl: 'https://example.org/psyche/self-obligations',
  }))
  assert.match(html, /编辑稿暂不可用/)
  assert.match(html, /来源入口：Psyche/)
  assert.doesNotMatch(html, /不善待自己|EditorialBrief|内容解读/)
})

test('reading time estimate scales with CJK text and floors at one minute', () => {
  assert.equal(estimateReadingMinutes(''), 1)
  assert.equal(estimateReadingMinutes('短文本'), 1)
  assert.ok(estimateReadingMinutes('汉'.repeat(800)) >= 2)
})

test('blocks with unknown source ids fail closed', () => {
  const broken = parseEditorialArticleV2(loadFixture('editorial-v2-brief.mock.json'))
  assert.ok(broken)
  const bad = structuredClone(broken) as unknown as Record<string, unknown>
  const article = bad.article as Record<string, unknown>
  const sections = article.sections as Array<Record<string, unknown>>
  const blocks = sections[0].blocks as Array<Record<string, unknown>>
  blocks[0].source_ids = ['src_99']
  assert.equal(parseEditorialArticleV2(bad), null)
})

test('publication contract rejects placeholder prose even though development fixtures are valid', () => {
  const fixture = loadFixture('editorial-v2-brief.mock.json') as Record<string, unknown>
  const invalid = structuredClone(fixture) as Record<string, unknown>
  const article = invalid.article as Record<string, unknown>
  article.title = '待补充的标题'
  assert.equal(parseEditorialArticleV2(invalid), null)
})

test('reader validation remains usable when the Node Buffer global is absent', () => {
  const saved = (globalThis as { Buffer?: unknown }).Buffer
  try {
    ;(globalThis as { Buffer?: unknown }).Buffer = undefined
    assert.ok(fixturePublication())
  } finally {
    ;(globalThis as { Buffer?: unknown }).Buffer = saved
  }
})

test('reader validation rejects bidi format controls except the allowed emoji joiner', () => {
  const fixture = loadFixture('editorial-v2-brief.mock.json') as Record<string, unknown>
  for (const control of ['\u061c', '\u2066']) {
    const invalid = structuredClone(fixture) as Record<string, unknown>
    const article = invalid.article as Record<string, unknown>
    article.title = `标题${control}内容`
    assert.equal(parseEditorialArticleV2(invalid), null)
  }
})
