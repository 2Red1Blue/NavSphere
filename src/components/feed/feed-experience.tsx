'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { Pause, Play } from 'lucide-react'

const ExperienceContext = createContext<{ light: boolean; setLight: (value: boolean) => void }>({
  light: false,
  setLight: () => {},
})

export const useFeedExperience = () => useContext(ExperienceContext)

export function FeedExperience({ children }: { children: React.ReactNode }) {
  const [light, setLight] = useState(false)
  const [effects, setEffects] = useState(true)
  const [ready, setReady] = useState(false)
  const [reduced, setReduced] = useState(false)
  const active = effects && !reduced

  useEffect(() => {
    try {
      setLight(localStorage.getItem('navsphere-feed-theme') === 'light')
      setEffects(localStorage.getItem('navsphere-feed-effects') !== 'off')
    } catch { /* Storage may be disabled; controls still work for this visit. */ }
    setReady(true)
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updateMotion = () => setReduced(media.matches)
    updateMotion()
    media.addEventListener('change', updateMotion)
    const root = document.documentElement
    const previousTheme = root.getAttribute('data-feed-theme')
    const previousEffects = root.getAttribute('data-feed-effects')
    return () => {
      media.removeEventListener('change', updateMotion)
      if (previousTheme === null) root.removeAttribute('data-feed-theme')
      else root.setAttribute('data-feed-theme', previousTheme)
      if (previousEffects === null) root.removeAttribute('data-feed-effects')
      else root.setAttribute('data-feed-effects', previousEffects)
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    document.documentElement.dataset.feedTheme = light ? 'light' : 'dark'
    document.documentElement.dataset.feedEffects = active ? 'on' : 'off'
    try {
      localStorage.setItem('navsphere-feed-theme', light ? 'light' : 'dark')
      localStorage.setItem('navsphere-feed-effects', effects ? 'on' : 'off')
    } catch { /* Persistence is optional. */ }
  }, [light, effects, active, ready])

  return (
    <ExperienceContext.Provider value={{ light, setLight }}>
      <div className={`feed-experience ${light ? '' : 'dark'}`}>
        {children}
        <button type="button" className="cyber-effects-control" disabled={reduced} title={reduced ? '已遵循系统减少动态效果设置' : undefined} onClick={() => setEffects(!effects)} aria-pressed={active} aria-label={active ? '关闭赛博特效' : '开启赛博特效'}>
          {active ? <Pause className="h-3 w-3" aria-hidden="true" /> : <Play className="h-3 w-3" aria-hidden="true" />}
          <span>特效 {active ? 'ON' : 'OFF'}</span>
        </button>
      </div>
    </ExperienceContext.Provider>
  )
}
