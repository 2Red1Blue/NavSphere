'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { ArrowUpRight } from 'lucide-react'
import type { FeedTopic } from '@/lib/topic-explorer'

// Positions are exhibition slots, not inferred relationships or data coordinates.
const SLOTS = [{ x: 34, y: 24 }, { x: 65, y: 37 }, { x: 29, y: 50 }, { x: 62, y: 65 }, { x: 28, y: 79 }, { x: 64, y: 91 }]

export function TopicSpace({ topics, selected, onSelect }: {
  topics: FeedTopic[]
  selected: string
  onSelect: (name: string) => void
}) {
  const stage = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  const reset = () => { if (stage.current) stage.current.style.transform = '' }
  const tilt = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || document.documentElement.dataset.feedEffects !== 'on' || matchMedia('(prefers-reduced-motion: reduce)').matches) { reset(); return }
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1))
    const y = Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1))
    if (stage.current) stage.current.style.transform = `perspective(1100px) rotateY(${x * 2}deg) rotateX(${-y * 2}deg)`
  }

  return (
    <section className={`topic-space ${failed ? 'topic-space-unavailable' : ''}`} aria-label="专题空间" onPointerMove={tilt} onPointerLeave={reset}>
      <div className="topic-space-caption"><span>专题探索</span><span>选择一个专题，开始阅读</span></div>
      <div ref={stage} className="topic-space-stage">
        {!failed && <Image src="/images/feed/topic-atrium-v1.webp" alt="" fill sizes="(max-width: 767px) 100vw, 650px" priority unoptimized className="topic-space-art" onError={() => setFailed(true)} />}
        <div className="topic-space-nodes" role="group" aria-label="空间中的专题">
          {topics.slice(0, SLOTS.length).map((topic, index) => <button
            type="button" key={topic.name} aria-pressed={selected === topic.name}
            className={`topic-space-node ${selected === topic.name ? 'is-selected' : ''}`}
            style={{ left: `${SLOTS[index].x}%`, top: `${SLOTS[index].y}%`, animationDelay: `${index * 60}ms` }}
            onClick={() => onSelect(topic.name)}>
            <span className="topic-space-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <span><strong>{topic.name}</strong><small>{topic.count} 篇文章</small></span>
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>)}
        </div>
      </div>
      <p className="topic-space-legend">{failed ? '空间图暂不可用，专题按钮仍可直接选择。' : '空间为导航展示，位置与距离不代表专题关联。'}</p>
    </section>
  )
}
