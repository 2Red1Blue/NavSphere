'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Star, List, TrendingUp, Tags } from 'lucide-react'

interface SidebarNavProps {
  topics?: { name: string; count: number }[]
}

export default function SidebarNav({ topics = [] }: SidebarNavProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentFeatured = searchParams.get('featured') === 'true'

  const navItems = [
    {
      href: '/feed',
      label: '全部',
      icon: List,
      active: pathname === '/feed' && !currentFeatured
    },
    {
      href: '/feed?featured=true',
      label: '精选',
      icon: Star,
      active: currentFeatured
    },
    {
      href: '/feed/hot',
      label: '热点榜',
      icon: TrendingUp,
      active: pathname === '/feed/hot'
    },
    {
      href: '/feed/topics',
      label: '主题',
      icon: Tags,
      active: pathname === '/feed/topics'
    }
  ]

  return (
    <aside className="w-64 flex-shrink-0 hidden lg:block">
      <nav className="sticky top-20 space-y-2">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors ${
              item.active
                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-semibold'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            <item.icon className="w-5 h-5" />
            <span>{item.label}</span>
          </Link>
        ))}

        {/* Topics section */}
        {topics.length > 0 && (
          <div className="mt-8 pt-4 border-t border-gray-200 dark:border-gray-700">
            <h3 className="px-4 mb-3 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              热门主题
            </h3>
            <div className="space-y-1">
              {topics.slice(0, 10).map((topic) => (
                <Link
                  key={topic.name}
                  href={`/feed?topic=${encodeURIComponent(topic.name)}`}
                  className="flex items-center justify-between px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <span className="truncate">{topic.name}</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">
                    {topic.count}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </nav>
    </aside>
  )
}
