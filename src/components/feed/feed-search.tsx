'use client'

import { useState, useCallback, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/registry/new-york/ui/input'
import { Button } from '@/registry/new-york/ui/button'
import { cn } from '@/lib/utils'

interface FeedSearchProps {
  onSearch: (query: string) => void
  className?: string
}

export function FeedSearch({ onSearch, className }: FeedSearchProps) {
  const [value, setValue] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleChange = useCallback(
    (newValue: string) => {
      setValue(newValue)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        onSearch(newValue.trim())
      }, 300)
    },
    [onSearch]
  )

  const handleClear = useCallback(() => {
    setValue('')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    onSearch('')
  }, [onSearch])

  return (
    <div className={cn('relative', className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        type="search"
        placeholder="搜索文章..."
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        className="pl-9 pr-8 h-9 text-sm"
        aria-label="搜索文章"
      />
      {value && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
          onClick={handleClear}
          aria-label="清除搜索"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}
