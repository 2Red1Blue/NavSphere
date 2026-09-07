import type { Metadata } from 'next'
import { FeedExperience } from '@/components/feed/feed-experience'

export const metadata: Metadata = {
  title: {
    default: 'Feed',
    template: '%s - Feed',
  },
  description: 'Content OS 精选 — AI 安全、AI 工程与认知科学领域的高质量内容',
}

export default function FeedLayout({ children }: { children: React.ReactNode }) {
  return <FeedExperience>{children}</FeedExperience>
}
