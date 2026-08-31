// Hot Topics API - 热点榜
import { getRequestContext } from '@cloudflare/next-on-pages'

export const runtime = 'edge'

export async function GET(request: Request) {
  const { env } = getRequestContext()
  
  // 计算48小时前的时间戳
  const hoursAgo = 48
  const cutoff = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString()
  
  // 查询最近48小时内出现频率最高的话题（基于 title 和 summary 的关键词）
  // 简化实现：按 source 和 category 分组统计
  const result = await env.DB.prepare(`
    SELECT 
      source,
      category,
      COUNT(*) as count,
      GROUP_CONCAT(url_hash, ',') as article_ids
    FROM articles 
    WHERE approved_for_publication = 1 AND discovered_at >= ?
    GROUP BY source, category
    ORDER BY count DESC
    LIMIT 20
  `).bind(cutoff).all()

  // 提取热点话题（基于高频出现的关键词）
  const topics = await env.DB.prepare(`
    SELECT 
      topic,
      COUNT(*) as count
    FROM articles 
    WHERE approved_for_publication = 1 AND discovered_at >= ? AND topic IS NOT NULL
    GROUP BY topic
    ORDER BY count DESC
    LIMIT 20
  `).bind(cutoff).all()

  return new Response(JSON.stringify({
    timeWindow: `${hoursAgo}h`,
    sources: result.results,
    topics: topics.results,
    generatedAt: new Date().toISOString()
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=300'
    }
  })
}
