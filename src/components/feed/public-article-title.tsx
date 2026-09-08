import React from 'react'
import { getArticleDisplayTitle, type PublicTitleSource } from '@/lib/feed-view'

export function PublicArticleTitle({ article }: {
  article: PublicTitleSource
}) {
  return <>{getArticleDisplayTitle(article)}</>
}
