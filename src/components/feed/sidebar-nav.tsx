'use client'

import { Star, List, TrendingUp, Tags, FileText, BookOpen, Lightbulb, Newspaper, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface SidebarNavProps {
  categories?: { name: string; count: number }[]
  types?: { name: string; count: number }[]
  selectedCategory?: string
  selectedType?: string
  onCategoryChange?: (category: string) => void
  onTypeChange?: (type: string) => void
}

// 领域中文映射
const CATEGORY_DISPLAY: Record<string, string> = {
  'ai-engineering': 'AI 工程',
  'ai-safety': 'AI 安全',
  'cognitive-science': '认知科学',
  'decision-method': '决策方法',
  'health-science': '健康科学',
  'social-observation': '社会观察',
  'tech-industry': '技术产业',
  'general': '综合',
}

// 类型图标和中文映射
const TYPE_CONFIG: Record<string, { icon: LucideIcon; label: string }> = {
  'paper': { icon: FileText, label: '论文' },
  'tutorial': { icon: BookOpen, label: '教程' },
  'deep': { icon: Lightbulb, label: '深度' },
  'news': { icon: Newspaper, label: '新闻' },
  'tool': { icon: Wrench, label: '工具' },
}

export default function SidebarNav({
  categories = [],
  types = [],
  selectedCategory = 'all',
  selectedType = 'all',
  onCategoryChange,
  onTypeChange,
}: SidebarNavProps) {
  const navItems = [
    { href: '/feed', icon: List, label: '全部' },
    { href: '/feed?featured=true', icon: Star, label: '精选' },
    { href: '/feed/hot', icon: TrendingUp, label: '热点榜' },
  ]

  return (
    <aside className="w-64 flex-shrink-0 hidden lg:block">
      <nav className="sticky top-20 space-y-6">
        {/* 主导航 */}
        <div className="space-y-1">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2 text-sm rounded-lg hover:bg-accent transition-colors"
            >
              <item.icon className="w-4 h-4" />
              <span>{item.label}</span>
            </a>
          ))}
        </div>

        {/* 领域筛选 */}
        {categories.length > 0 && (
          <div className="space-y-2">
            <h3 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              领域
            </h3>
            <div className="space-y-1">
              <button
                onClick={() => onCategoryChange?.('all')}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  selectedCategory === 'all'
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-accent'
                }`}
              >
                <span>全部</span>
                <span className="text-xs opacity-70">
                  {categories.reduce((sum, c) => sum + c.count, 0)}
                </span>
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.name}
                  onClick={() => onCategoryChange?.(cat.name)}
                  className={`w-full flex items-center justify-between px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    selectedCategory === cat.name
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-accent'
                  }`}
                >
                  <span>{CATEGORY_DISPLAY[cat.name] || cat.name}</span>
                  <span className="text-xs opacity-70">{cat.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 类型筛选 */}
        {types.length > 0 && (
          <div className="space-y-2">
            <h3 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              类型
            </h3>
            <div className="space-y-1">
              <button
                onClick={() => onTypeChange?.('all')}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  selectedType === 'all'
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-accent'
                }`}
              >
                <span>全部</span>
                <span className="text-xs opacity-70">
                  {types.reduce((sum, t) => sum + t.count, 0)}
                </span>
              </button>
              {types.map((type) => {
                const config = TYPE_CONFIG[type.name] || { icon: FileText, label: type.name }
                const Icon = config.icon
                return (
                  <button
                    key={type.name}
                    onClick={() => onTypeChange?.(type.name)}
                    className={`w-full flex items-center justify-between px-3 py-1.5 text-sm rounded-lg transition-colors ${
                      selectedType === type.name
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-accent'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="w-3.5 h-3.5" />
                      <span>{config.label}</span>
                    </span>
                    <span className="text-xs opacity-70">{type.count}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </nav>
    </aside>
  )
}
