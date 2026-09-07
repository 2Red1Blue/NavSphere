'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { useState } from 'react'
import { topicPageUrl, type FeedTopic } from '@/lib/topic-explorer'

export function TopicDiscovery({ topics }: { topics: FeedTopic[] }) {
  const [imageFailed, setImageFailed] = useState(false)
  return <section className="topic-discovery" aria-label="探索专题">
    <div className="topic-discovery-copy">
      <p className="feed-kicker mb-2">换个角度，发现内容</p>
      <Link href="/feed/topics" className="topic-discovery-title">从一个专题开始<ArrowUpRight className="h-5 w-5" aria-hidden="true" /></Link>
      <p className="feed-muted mt-2 text-sm leading-6">进入专题空间，浏览相关报道与研究。</p>
      <div className="topic-discovery-links">{topics.slice(0, 3).map(topic => <Link key={topic.name} href={topicPageUrl(topic.name)}>{topic.name}<span>{topic.count}</span></Link>)}</div>
    </div>
    {!imageFailed && <Image src="/images/feed/topic-atrium-v1.webp" alt="" width={200} height={200} unoptimized className="topic-discovery-art" onError={() => setImageFailed(true)} />}
  </section>
}
