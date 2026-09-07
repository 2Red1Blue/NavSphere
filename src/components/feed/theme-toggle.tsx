'use client'

import { useFeedExperience } from './feed-experience'
import { Moon, Sun } from 'lucide-react'

export function FeedThemeToggle() {
  const { light, setLight } = useFeedExperience()
  const dark = !light
  return (
    <button type="button" onClick={() => setLight(!light)}
      className="feed-theme-toggle feed-muted relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-[hsl(var(--feed-ink)/.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--feed-accent))]"
      aria-label={dark ? '切换浅色模式' : '切换深色模式'} title={dark ? '切换浅色模式' : '切换深色模式'}>
      <Sun aria-hidden="true" className={`absolute h-4 w-4 transition-[transform,opacity] duration-200 ${dark ? 'rotate-0 opacity-100' : '-rotate-90 opacity-0'}`} />
      <Moon aria-hidden="true" className={`absolute h-4 w-4 transition-[transform,opacity] duration-200 ${dark ? 'rotate-90 opacity-0' : 'rotate-0 opacity-100'}`} />
    </button>
  )
}
