import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canRenderFullContent,
  extractMarkdownHeadings,
  normalizeReaderMarkdown,
} from '../src/lib/reader-markdown'

test('normalizeReaderMarkdown removes only leading frontmatter and normalizes line endings', () => {
  const markdown = [
    '\uFEFF---\r',
    'title: Reader fixture\r',
    'source: https://example.com\r',
    '---\r',
    '\r',
    '## First section\r',
    'A deliberately wrapped\r',
    'paragraph remains wrapped.\r',
    '\r',
    '---\r',
    '\r',
    '    const preserved = true\r',
  ].join('\n')

  assert.equal(
    normalizeReaderMarkdown(markdown),
    [
      '## First section',
      'A deliberately wrapped',
      'paragraph remains wrapped.',
      '',
      '---',
      '',
      '    const preserved = true',
    ].join('\n'),
  )
})

test('normalizeReaderMarkdown leaves ordinary leading thematic breaks intact', () => {
  assert.equal(normalizeReaderMarkdown('---\n\nOpening paragraph'), '---\n\nOpening paragraph')
})

test('normalizeReaderMarkdown removes only a leading h1 that duplicates the page title', () => {
  const markdown = '# Article title\n\n## First section\n\nBody'
  assert.equal(
    normalizeReaderMarkdown(markdown, 'Article title'),
    '## First section\n\nBody',
  )
  assert.equal(normalizeReaderMarkdown(markdown, 'Different title'), markdown)
})

test('normalizeReaderMarkdown removes a matching generated summary only at the end', () => {
  const markdown = [
    '# Article title',
    '',
    '## Body',
    '',
    'Original paragraph.',
    '',
    '## AI 摘要',
    '',
    'Generated summary line one.',
    'Generated summary line two.',
  ].join('\n')

  assert.equal(
    normalizeReaderMarkdown(markdown, 'Article title', 'Generated summary line one.\nGenerated summary line two.'),
    ['## Body', '', 'Original paragraph.'].join('\n'),
  )
  assert.equal(
    normalizeReaderMarkdown(markdown, 'Article title', 'Generated summary line one.'),
    markdown.slice(markdown.indexOf('## Body')),
  )
  assert.equal(
    normalizeReaderMarkdown(markdown, undefined, 'Generated summary line one.\nGenerated summary line two.'),
    ['# Article title', '', '## Body', '', 'Original paragraph.'].join('\n'),
  )
  assert.equal(
    normalizeReaderMarkdown(markdown, 'Article title', 'A different summary'),
    markdown.slice(markdown.indexOf('## Body')),
  )
})

test('normalizeReaderMarkdown preserves a normal AI 摘要 chapter when it is not generated at the end', () => {
  const markdown = '## AI 摘要\n\nA normal chapter.\n\n## Next chapter\n\nMore content.'
  assert.equal(normalizeReaderMarkdown(markdown, undefined, 'A normal chapter.'), markdown)
})

test('normalizeReaderMarkdown preserves legitimate content after a summary-like paragraph', () => {
  const markdown = '## AI 摘要\n\nGenerated summary.\n\nAn editorial note with more content.'
  assert.equal(normalizeReaderMarkdown(markdown, undefined, 'Generated summary.'), markdown)

  const whitespaceVariant = '## AI 摘要\n\na b c\n\nMore content.'
  assert.equal(normalizeReaderMarkdown(whitespaceVariant, undefined, 'ab c'), whitespaceVariant)
})

test('normalizeReaderMarkdown removes recognized generated metadata after a summary', () => {
  const markdown = [
    '## AI 摘要',
    '',
    'Generated summary.',
    '',
    '**核心观点:** A generated takeaway.',
    '',
    '**评分:** 25/30',
  ].join('\n')
  assert.equal(normalizeReaderMarkdown(markdown, undefined, 'Generated summary.'), '')
})

test('extractMarkdownHeadings uses the Markdown AST and stable duplicate slugs', () => {
  const markdown = [
    '# Page title',
    '## **Hello** [world](https://example.com)',
    '## Hello world',
    '```md',
    '## Not a real heading',
    '```',
    'API reference',
    '-------------',
    '#### `fetch()` details',
    '### ~~Deprecated~~ API',
    '## Foo <b>bar</b>',
    '##### Excluded depth',
  ].join('\n')

  assert.deepEqual(extractMarkdownHeadings(markdown).map(({ id, text, level }) => ({ id, text, level })), [
    { id: 'hello-world', text: 'Hello world', level: 2 },
    { id: 'hello-world-1', text: 'Hello world', level: 2 },
    { id: 'api-reference', text: 'API reference', level: 2 },
    { id: 'fetch-details', text: 'fetch() details', level: 4 },
    { id: 'deprecated-api', text: 'Deprecated API', level: 3 },
    { id: 'foo-bar', text: 'Foo bar', level: 2 },
  ])
})

test('extractMarkdownHeadings omits footnote markers but keeps ordinary link labels', () => {
  const markdown = [
    '## A related mental model[[4]](#fnzohh3n5blo)',
    '## **Hello** [world](https://example.com)',
    '## Foot[^4]',
    '',
    '[^4]: footnote text',
  ].join('\n')

  assert.deepEqual(extractMarkdownHeadings(markdown).map(({ text }) => text), [
    'A related mental model',
    'Hello world',
    'Foot',
  ])
})

test('canRenderFullContent fails closed unless body, quality, format, and permission agree', () => {
  const verified = {
    content: '## Verified article',
    content_quality: 'verified_fulltext',
    content_format: 'markdown_v1',
    fulltext_publication_allowed: true,
  } as const

  assert.equal(canRenderFullContent(verified), true)
  assert.equal(canRenderFullContent({ ...verified, content: '   ' }), false)
  assert.equal(canRenderFullContent({ ...verified, content_quality: 'summary_only' }), false)
  assert.equal(canRenderFullContent({ ...verified, content_format: 'html' }), false)
  assert.equal(canRenderFullContent({ ...verified, fulltext_publication_allowed: false }), false)
  assert.equal(canRenderFullContent({ ...verified, fulltext_publication_allowed: 1 }), true)
  assert.equal(canRenderFullContent({ ...verified, fulltext_publication_allowed: 0 }), false)
  assert.equal(canRenderFullContent({ ...verified, fulltext_publication_allowed: '1' as never }), false)
  assert.equal(canRenderFullContent({ content: verified.content }), false)
})
