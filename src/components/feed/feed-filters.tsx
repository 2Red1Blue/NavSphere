'use client'

import { cn } from '@/lib/utils'
import { Button } from '@/registry/new-york/ui/button'

interface FeedFiltersProps {
  categories: { name: string; count: number }[]
  selected: string
  onSelect: (category: string) => void
  className?: string
}

export function FeedFilters({ categories, selected, onSelect, className }: FeedFiltersProps) {
  return (
    <div className={cn('relative', className)}>
      <div
        className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide"
        role="group"
        aria-label="分类筛选"
      >
        <Button
          variant={selected === 'all' ? 'default' : 'ghost'}
          size="sm"
          className="shrink-0 text-xs h-7 px-2.5 rounded-full"
          onClick={() => onSelect('all')}
        >
          全部
        </Button>
        {categories.map((cat) => (
          <Button
            key={cat.name}
            variant={selected === cat.name ? 'default' : 'ghost'}
            size="sm"
            className="shrink-0 text-xs h-7 px-2.5 rounded-full"
            onClick={() => onSelect(cat.name)}
          >
            {cat.name}
            <span className="ml-1 text-[10px] opacity-60">{cat.count}</span>
          </Button>
        ))}
      </div>
      {/* Mobile fade indicator */}
      <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent pointer-events-none md:hidden" />
    </div>
  )
}