'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/registry/new-york/ui/button'
import { ScrollArea } from '@/registry/new-york/ui/scroll-area'
import { Newspaper, ChevronRight, Star } from 'lucide-react'

interface FeedSidebarProps {
  categories: { name: string; count: number }[]
  sources: { name: string; count: number }[]
  selectedCategory: string
  selectedSource: string
  minScore: number
  onCategoryChange: (cat: string) => void
  onSourceChange: (src: string) => void
  onScoreChange: (score: number) => void
  onReset: () => void
  className?: string
  onClose?: () => void
}

const CATEGORY_LABELS: Record<string, string> = {
  'ai-safety': 'AI 安全',
  'ai-engineering': 'AI 工程',
  'cognitive-science': '认知科学',
  'ai-tools': 'AI 工具',
  'general': '综合',
}

const SCORE_TIERS = [
  { min: 27, label: '≥27 神作', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  { min: 24, label: '≥24 佳作', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  { min: 21, label: '≥21 值得读', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
  { min: 0, label: '全部', color: 'bg-muted text-muted-foreground' },
]

export function FeedSidebar({
  categories,
  sources,
  selectedCategory,
  selectedSource,
  minScore,
  onCategoryChange,
  onSourceChange,
  onScoreChange,
  onReset,
  className,
  onClose,
}: FeedSidebarProps) {
  const pathname = usePathname()
  const hasFilters = selectedCategory !== 'all' || selectedSource !== 'all' || minScore > 0

  return (
    <div className={cn('flex flex-col w-56 bg-background', className)}>
      {/* Feed Home Link */}
      <div className="px-3 py-2">
        <Link
          href="/feed"
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors',
            pathname === '/feed'
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
          )}
          onClick={onClose}
        >
          <Newspaper className="h-4 w-4" />
          <span>📰 Feed 首页</span>
        </Link>
      </div>

      <ScrollArea className="flex-1 px-3">
        {/* Categories */}
        <div className="py-2">
          <h3 className="px-2 mb-1 text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider">
            分类
          </h3>
          <div className="space-y-0.5">
            <Button
              variant={selectedCategory === 'all' ? 'secondary' : 'ghost'}
              size="sm"
              className="w-full justify-start text-xs h-7"
              onClick={() => onCategoryChange('all')}
            >
              全部
              <span className="ml-auto text-[10px] text-muted-foreground">
                {categories.reduce((s, c) => s + c.count, 0)}
              </span>
            </Button>
            {categories.map((cat) => (
              <Button
                key={cat.name}
                variant={selectedCategory === cat.name ? 'secondary' : 'ghost'}
                size="sm"
                className="w-full justify-start text-xs h-7"
                onClick={() => onCategoryChange(cat.name)}
              >
                {CATEGORY_LABELS[cat.name] || cat.name}
                <span className="ml-auto text-[10px] text-muted-foreground">{cat.count}</span>
              </Button>
            ))}
          </div>
        </div>

        {/* Score Tiers */}
        <div className="py-2">
          <h3 className="px-2 mb-1 text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider">
            评分
          </h3>
          <div className="space-y-0.5">
            {SCORE_TIERS.map((tier) => (
              <Button
                key={tier.min}
                variant={minScore === tier.min ? 'secondary' : 'ghost'}
                size="sm"
                className="w-full justify-start text-xs h-7"
                onClick={() => onScoreChange(tier.min)}
              >
                <Star className={cn('h-3 w-3 mr-1.5', tier.color.split(' ')[0])} />
                {tier.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Sources */}
        {sources.length > 0 && (
          <div className="py-2">
            <h3 className="px-2 mb-1 text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider">
              来源
            </h3>
            <div className="space-y-0.5">
              <Button
                variant={selectedSource === 'all' ? 'secondary' : 'ghost'}
                size="sm"
                className="w-full justify-start text-xs h-7"
                onClick={() => onSourceChange('all')}
              >
                全部
              </Button>
              {sources.slice(0, 8).map((src) => (
                <Button
                  key={src.name}
                  variant={selectedSource === src.name ? 'secondary' : 'ghost'}
                  size="sm"
                  className="w-full justify-start text-xs h-7"
                  onClick={() => onSourceChange(src.name)}
                >
                  <span className="truncate">{src.name}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{src.count}</span>
                </Button>
              ))}
            </div>
          </div>
        )}
      </ScrollArea>

      {/* Reset Filters */}
      {hasFilters && (
        <div className="px-3 py-2 border-t">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={onReset}
          >
            清除筛选
          </Button>
        </div>
      )}
    </div>
  )
}