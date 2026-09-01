'use client'

import Link from 'next/link'
import {
  BookOpen,
  CalendarDays,
  FileText,
  Flame,
  Hash,
  Home,
  Lightbulb,
  List,
  Newspaper,
  Sparkles,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { getCategoryLabel } from '@/lib/feed-view'

interface SidebarNavProps {
  categories?: { name: string; count: number }[]
  types?: { name: string; count: number }[]
  selectedCategory?: string
  selectedType?: string
  onCategoryChange?: (category: string) => void
  onTypeChange?: (type: string) => void
}

const TYPE_CONFIG: Record<string, { icon: LucideIcon; label: string }> = {
  paper: { icon: FileText, label: '论文' },
  tutorial: { icon: BookOpen, label: '教程' },
  deep: { icon: Lightbulb, label: '深度' },
  news: { icon: Newspaper, label: '新闻' },
  tool: { icon: Wrench, label: '工具' },
}

const NAV_ITEMS = [
  { href: '/feed?featured=true', icon: Sparkles, label: '精选' },
  { href: '/feed', icon: List, label: '全部 AI 动态' },
  { href: '/feed/hot', icon: Flame, label: '热点榜' },
  { href: '/feed/daily', icon: CalendarDays, label: 'AI 日报' },
  { href: '/feed#topics', icon: Hash, label: '主题' },
] as const

const filterClass = (selected: boolean) =>
  `w-full flex items-center justify-between rounded-md px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${
    selected ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
  }`

export default function SidebarNav({
  categories = [],
  types = [],
  selectedCategory = 'all',
  selectedType = 'all',
  onCategoryChange,
  onTypeChange,
}: SidebarNavProps) {
  return (
    <aside className="hidden w-64 flex-shrink-0 bg-background lg:block [.fixed_&]:block" aria-label="Feed 导航与筛选">
      <nav className="sticky top-20 space-y-7 p-4 lg:p-0">
        <div className="space-y-1" aria-label="内容导航">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            >
              <item.icon className="h-4 w-4" aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          ))}
          <Link
            href="/"
            className="mt-3 flex items-center gap-3 border-t border-border px-3 pt-4 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
          >
            <Home className="h-4 w-4" aria-hidden="true" />
            <span>返回导航站</span>
          </Link>
        </div>

        {categories.length > 0 && (
          <section aria-labelledby="category-filter-heading" className="space-y-2">
            <h2 id="category-filter-heading" className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              领域
            </h2>
            <div className="space-y-1">
              <button type="button" onClick={() => onCategoryChange?.('all')} className={filterClass(selectedCategory === 'all')}>
                <span>全部领域</span>
                <span className="text-xs tabular-nums opacity-70">{categories.reduce((sum, item) => sum + item.count, 0)}</span>
              </button>
              {categories.map((category) => (
                <button
                  type="button"
                  key={category.name}
                  onClick={() => onCategoryChange?.(category.name)}
                  className={filterClass(selectedCategory === category.name)}
                >
                  <span>{getCategoryLabel(category.name)}</span>
                  <span className="text-xs tabular-nums opacity-70">{category.count}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {types.length > 0 && (
          <section id="topics" aria-labelledby="type-filter-heading" className="scroll-mt-24 space-y-2">
            <h2 id="type-filter-heading" className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              主题类型
            </h2>
            <div className="space-y-1">
              <button type="button" onClick={() => onTypeChange?.('all')} className={filterClass(selectedType === 'all')}>
                <span>全部类型</span>
                <span className="text-xs tabular-nums opacity-70">{types.reduce((sum, item) => sum + item.count, 0)}</span>
              </button>
              {types.map((type) => {
                const config = TYPE_CONFIG[type.name] ?? { icon: FileText, label: type.name }
                const Icon = config.icon
                return (
                  <button
                    type="button"
                    key={type.name}
                    onClick={() => onTypeChange?.(type.name)}
                    className={filterClass(selectedType === type.name)}
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{config.label}</span>
                    </span>
                    <span className="text-xs tabular-nums opacity-70">{type.count}</span>
                  </button>
                )
              })}
            </div>
          </section>
        )}
      </nav>
    </aside>
  )
}
