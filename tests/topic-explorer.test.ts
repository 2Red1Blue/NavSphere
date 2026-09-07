import assert from 'node:assert/strict'
import test from 'node:test'
import { parseFeedTopics, topicFeedUrl, topicPageUrl } from '../src/lib/topic-explorer'

test('topic metadata rejects malformed rows without losing valid nonempty topics', () => {
  assert.deepEqual(parseFeedTopics([
    null, { name: '', count: 1 }, { name: ' ', count: 1 },
    { name: 'AI 工程', count: 107 }, { name: 'AI 工程', count: 8 },
    { name: '不存在', count: 0 }, { name: '负数', count: -2 },
    { name: '坏计数', count: '3' }, { name: '小数', count: 1.5 },
    { name: ' 理性主义 ', count: 255 },
  ]), [{ name: 'AI 工程', count: 107 }, { name: '理性主义', count: 255 }])
  assert.deepEqual(parseFeedTopics({ topics: [] }), [])
})

test('topic links preserve exact Unicode and cannot inject extra filters or fragments', () => {
  const topic = 'AI & 安全?featured=true#研究'
  const api = new URL(topicFeedUrl(topic), 'https://example.test')
  const page = new URL(topicPageUrl(topic), 'https://example.test')
  assert.equal(api.searchParams.get('topic'), topic)
  assert.equal(api.searchParams.get('limit'), '6')
  assert.equal(api.searchParams.has('featured'), false)
  assert.equal(api.hash, '')
  assert.equal(page.pathname, '/feed/topics')
  assert.equal(page.searchParams.get('topic'), topic)
  assert.equal(page.hash, '')
})
