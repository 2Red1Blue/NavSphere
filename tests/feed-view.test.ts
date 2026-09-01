import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getCategoryLabel,
  getDailySection,
  getScoreTier,
  groupArticlesByShanghaiDate,
  inferSourceType,
  partitionDailyArticles,
  toDisplayScore,
  toShanghaiDateKey,
} from '../src/lib/feed-view'

const baseArticle = {
  url_hash: 'article-1',
  title: '示例文章',
  category: 'general',
  type: 'news',
  topic: '',
  source: 'Example',
  discovered_at: '2026-08-31T12:00:00Z',
}

test('30-point scores convert to bounded 100-point display scores', () => {
  assert.equal(toDisplayScore(0), 0)
  assert.equal(toDisplayScore(15), 50)
  assert.equal(toDisplayScore(24), 80)
  assert.equal(toDisplayScore(27), 90)
  assert.equal(toDisplayScore(30), 100)
  assert.equal(toDisplayScore(-1), 0)
  assert.equal(toDisplayScore(31), 100)
  assert.equal(toDisplayScore(Number.NaN), 0)
})

test('score tiers use the same internal-to-display boundary', () => {
  assert.equal(getScoreTier(26.9).key, 'recommended')
  assert.equal(getScoreTier(27).key, 'must-read')
  assert.equal(getScoreTier(24).key, 'recommended')
  assert.equal(getScoreTier(18).key, 'notable')
  assert.equal(getScoreTier(17.9).key, 'standard')
})

test('Shanghai date keys cross the UTC day boundary at UTC+8', () => {
  assert.equal(toShanghaiDateKey('2026-08-31T15:59:59Z'), '2026-08-31')
  assert.equal(toShanghaiDateKey('2026-08-31T16:00:00Z'), '2026-09-01')
})

test('timeline groups are Shanghai-day based and deterministically newest first', () => {
  const groups = groupArticlesByShanghaiDate([
    { url_hash: 'b', discovered_at: '2026-08-31T15:30:00Z' },
    { url_hash: 'c', discovered_at: '2026-08-31T16:30:00Z' },
    { url_hash: 'a', discovered_at: '2026-08-31T16:30:00Z' },
  ])

  assert.deepEqual(groups.map((group) => group.dateKey), ['2026-09-01', '2026-08-31'])
  assert.deepEqual(groups[0].articles.map((article) => article.url_hash), ['a', 'c'])
})

test('daily sections map model, product, industry, and insight signals', () => {
  assert.equal(getDailySection({ ...baseArticle, title: '新推理模型发布', type: 'paper' }), 'models')
  assert.equal(getDailySection({ ...baseArticle, title: 'AI 编程助手上线', type: 'tool' }), 'products')
  assert.equal(getDailySection({ ...baseArticle, title: 'AI 芯片市场变化', category: 'tech-industry' }), 'industry')
  assert.equal(getDailySection({ ...baseArticle, title: 'Prompt 实践指南', type: 'tutorial' }), 'insights')
  assert.equal(getDailySection({ ...baseArticle, title: 'Release notes', category: 'models' }), 'models')
  assert.equal(getDailySection({ ...baseArticle, title: 'Research assistant', category: 'products' }), 'products')

  const partitioned = partitionDailyArticles([
    { ...baseArticle, url_hash: 'model', title: '模型评测', type: 'paper' },
    { ...baseArticle, url_hash: 'tool', title: 'Agent 工具', type: 'tool' },
    { ...baseArticle, url_hash: 'industry', title: '监管动态', category: 'tech-industry' },
    { ...baseArticle, url_hash: 'guide', title: '使用技巧', type: 'tutorial' },
  ])
  assert.deepEqual(Object.fromEntries(Object.entries(partitioned).map(([key, value]) => [key, value.length])), {
    models: 1,
    products: 1,
    industry: 1,
    insights: 1,
  })
})

test('category and source labels preserve useful fallbacks', () => {
  assert.equal(getCategoryLabel('ai-engineering'), 'AI 工程')
  assert.equal(getCategoryLabel('robotics'), 'robotics')
  assert.equal(getCategoryLabel(''), '综合')

  assert.equal(inferSourceType('OpenAI', 'https://openai.com/news').key, 'official')
  assert.equal(inferSourceType('arXiv', 'https://arxiv.org/abs/1234').key, 'research')
  assert.equal(inferSourceType('GitHub', 'https://github.com/example/repo').key, 'code')
  assert.equal(inferSourceType('Reuters', 'https://reuters.com/technology').key, 'media')
  assert.equal(inferSourceType('Uncatalogued source', 'not a url').key, 'unknown')
  assert.equal(inferSourceType('Uncatalogued source', 'not a url').label, '来源待核验')
})
