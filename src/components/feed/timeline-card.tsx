import Link from 'next/link'

interface TimelineCardProps {
  article: {
    url_hash: string
    title: string
    source: string
    score: number
    summary: string
    takeaway?: string
    discovered_at: string
    featured?: number
  }
}

function getScoreColor(score: number): string {
  if (score >= 75) return 'text-orange-600 dark:text-orange-400'
  if (score >= 50) return 'text-yellow-600 dark:text-yellow-400'
  return 'text-gray-500 dark:text-gray-400'
}

function getScoreBg(score: number): string {
  if (score >= 75) return 'bg-orange-100 dark:bg-orange-900/30'
  if (score >= 50) return 'bg-yellow-100 dark:bg-yellow-900/30'
  return 'bg-gray-100 dark:bg-gray-800'
}

export default function TimelineCard({ article }: TimelineCardProps) {
  const time = new Date(article.discovered_at).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  })

  return (
    <Link href={`/feed/${article.url_hash}`} className="group">
      <div className="flex gap-4 py-6 px-6 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
        {/* 左侧时间线 */}
        <div className="flex flex-col items-center">
          <div className="text-xs text-gray-500 dark:text-gray-400 font-mono w-12 text-center">
            {time}
          </div>
          <div className="mt-2 w-2 h-2 rounded-full bg-blue-500 dark:bg-blue-400 ring-4 ring-blue-100 dark:ring-blue-900/30" />
          <div className="flex-1 w-px bg-gray-200 dark:bg-gray-700 my-2" />
        </div>

        {/* 右侧卡片内容 */}
        <div className="flex-1 min-w-0">
          {/* 卡片头部 */}
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                {article.source}
              </span>
              {article.featured === 1 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                  ⭐ 精选
                </span>
              )}
            </div>
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${getScoreBg(article.score)}`}>
              <span className={`text-lg font-bold ${getScoreColor(article.score)}`}>
                {article.score}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">/ 100</span>
            </div>
          </div>

          {/* 标题 */}
          <h3 className="text-xl font-semibold mb-3 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-2">
            {article.title}
          </h3>

          {/* 摘要 */}
          <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-3 line-clamp-3">
            {article.summary}
          </p>

          {/* 推荐理由 (takeaway) */}
          {article.takeaway && (
            <>
              <div className="border-t border-gray-200 dark:border-gray-700 my-3" />
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <span className="text-blue-600 dark:text-blue-400 text-sm font-semibold mt-0.5">
                    💡 推荐理由
                  </span>
                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed line-clamp-2">
                    {article.takeaway}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </Link>
  )
}
