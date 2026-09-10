import {
  parseEditorialArticleV2,
  type EditorialArticleV2,
} from '../editorial-article'

import briefMock from './editorial-v2-brief.mock.json'
import explainerMock from './editorial-v2-explainer.mock.json'

/**
 * Mock fixtures are placeholder copy for layout/interaction verification only.
 * Every fixture is marked 【占位】 in its text and must never be published.
 * Shapes follow publication_renderer_v2 (CONTRACT.md §3.6): field-set closure,
 * items[]-only lists, optional downgraded_from / attribution / original_title.
 */
const MOCKS: Record<string, unknown> = {
  brief: briefMock,
  explainer: explainerMock,
}

export const MOCK_EDITORIAL_ARTICLE_V2_KEYS = Object.keys(MOCKS)

export function loadMockEditorialArticleV2(key: string): EditorialArticleV2 | null {
  if (!Object.hasOwn(MOCKS, key)) return null
  return parseEditorialArticleV2(MOCKS[key])
}
