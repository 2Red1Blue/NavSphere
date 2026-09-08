import React from 'react'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { formatShanghaiTime } from '@/lib/feed-view'
import type { Article } from '@/types/feed'
import { PublicArticleTitle } from './public-article-title'

export function TopicReadingArticle({ article }: { article: Article }) {
  return <article className="topic-reading-article"><Link href={`/feed/${article.url_hash}`}>
    <p className="feed-muted mb-2 text-xs">{article.source && <>{article.source} <span aria-hidden="true">·</span> </>}<time dateTime={article.discovered_at}>{formatShanghaiTime(article.discovered_at)}</time></p>
    <h3 className="text-lg font-semibold leading-relaxed"><PublicArticleTitle article={article} /></h3>
    {article.summary && <p className="feed-muted mt-2 line-clamp-2 text-sm leading-7">{article.summary}</p>}
    <span className="topic-reading-link">阅读全文 <ArrowUpRight className="h-3 w-3" aria-hidden="true" /></span>
  </Link></article>
}
