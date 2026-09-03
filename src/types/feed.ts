// Types for the Content OS Feed module

export interface Article {
  url_hash: string
  title: string
  original_title?: string
  summary?: string
  takeaway?: string
  content?: string | null
  content_format?: 'markdown_v1' | null
  content_quality?: 'verified_fulltext' | 'summary_only' | 'legacy_unverified' | null
  content_hash?: string | null
  content_chars?: number | null
  content_quality_score?: number | null
  content_version?: number | null
  content_source?: string | null
  content_extracted_at?: string | null
  fulltext_publication_allowed?: boolean | number | null
  source: string
  url: string
  category: string
  topic?: string
  type?: string
  featured?: number
  score: number
  signal: number
  novelty: number
  usefulness: number
  content_potential?: 'High' | 'Medium' | 'Low'
  published_at?: string
  discovered_at: string
  created_at: string
}

// Alias for feed components
export type FeedArticle = Article

export interface FeedListResponse {
  data: Article[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  categories: {
    name: string
    count: number
  }[]
  types: {
    name: string
    count: number
  }[]
  topics: {
    name: string
    count: number
  }[]
}

export interface FeedStatsResponse {
  total: number
  today: number
  categories: {
    name: string
    count: number
  }[]
  topSources: {
    name: string
    count: number
  }[]
}

export interface FeedError {
  error: {
    code: string
    message: string
    details?: string[]
  }
}

export type FeedState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'no_results'; filters: string }
  | { status: 'success'; data: Article[]; pagination: FeedListResponse['pagination']; categories: FeedListResponse['categories'] }
