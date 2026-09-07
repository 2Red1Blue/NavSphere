import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { FeedThemeToggle } from './theme-toggle'

export function FeedMasthead({ section }: { section?: string }) {
  return (
    <header className="feed-hairline border-b">
      <div className="mx-auto flex max-w-[76rem] items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/feed" className="group inline-flex items-center gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--feed-accent))]">
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1 motion-reduce:transform-none" aria-hidden="true" />
          <span className="feed-display text-xl font-semibold">NavSphere</span>
        </Link>
        <div className="flex items-center gap-4"><span className="feed-kicker">{section || 'AI 资讯'}</span><FeedThemeToggle /></div>
      </div>
    </header>
  )
}
