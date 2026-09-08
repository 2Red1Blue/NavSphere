import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'

import { FeedCard } from '../src/components/feed/feed-card'
import TimelineCard from '../src/components/feed/timeline-card'
import { PublicArticleTitle } from '../src/components/feed/public-article-title'
import { DailyArticleItem, type DailyArticleItemData } from '../src/components/feed/daily-article-item'
import { TopicReadingArticle } from '../src/components/feed/topic-reading-article'
import type { Article } from '../src/types/feed'

const article: Article = {
  url_hash: '0123456789abcdef',
  title: '整理帖称某事',
  original_title: '真实上游标题',
  summary: '摘要',
  takeaway: '推荐理由',
  source: '来源',
  url: 'https://example.test/article',
  category: 'general',
  type: 'news',
  score: 0,
  signal: 0,
  novelty: 0,
  usefulness: 0,
  discovered_at: '2026-09-08T00:00:00Z',
  created_at: '2026-09-08T00:00:00Z',
}

test('public feed cards use upstream titles and hide unavailable scores', () => {
  for (const component of [FeedCard, TimelineCard]) {
    const html = renderToStaticMarkup(createElement(component, { article }))
    assert.match(html, /真实上游标题/)
    assert.doesNotMatch(html, /整理帖称某事|0\/100|0\/30|评分 0/)
  }
})

test('shared title renderer keeps daily and topic surfaces on the same precedence', () => {
  const html = renderToStaticMarkup(createElement(PublicArticleTitle, { article }))
  assert.equal(html, '真实上游标题')
  assert.equal(renderToStaticMarkup(createElement(PublicArticleTitle, { article: { title: '回退标题' } })), '回退标题')
})

function dailyArticle(): DailyArticleItemData {
  return {
    url_hash: article.url_hash,
    title: article.title,
    original_title: article.original_title ?? null,
    summary: article.summary ?? null,
    takeaway: article.takeaway ?? null,
    source: article.source,
    category: article.category,
    topic: article.topic ?? null,
    type: article.type ?? null,
    displayScore: 0,
    discovered_at: article.discovered_at,
  }
}

test('DailyArticleItem renders the upstream title and hides unavailable score output', () => {
  const dailyHtml = renderToStaticMarkup(createElement(DailyArticleItem, { article: dailyArticle() }))
  assert.match(dailyHtml, /真实上游标题/)
  assert.doesNotMatch(dailyHtml, /整理帖称某事/)
  assert.doesNotMatch(dailyHtml, /AI 0|0\/100/)
  assert.equal((dailyHtml.match(/>·<\/span>/g) ?? []).length, 1)
})

test('TopicReadingArticle renders upstream and fallback titles without a dangling source separator', () => {
  const upstreamHtml = renderToStaticMarkup(createElement(TopicReadingArticle, { article }))
  const fallbackHtml = renderToStaticMarkup(createElement(TopicReadingArticle, { article: { ...article, source: '', original_title: undefined, title: '回退标题' } }))
  assert.match(upstreamHtml, /真实上游标题/)
  assert.doesNotMatch(upstreamHtml, /整理帖称某事/)
  assert.match(fallbackHtml, /回退标题/)
  assert.doesNotMatch(fallbackHtml, />·<\/span>/)
})
