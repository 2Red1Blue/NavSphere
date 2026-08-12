import { getRequestContext } from '@cloudflare/next-on-pages'

export const runtime = 'edge'

export async function GET(request: Request) {
  const { env } = getRequestContext()
  
  const keys = Object.keys(env)
  const hasContentOsKey = 'CONTENT_OS_API_KEY' in env
  const keyValue = env.CONTENT_OS_API_KEY
  const keyLength = keyValue ? String(keyValue).length : 0
  const keyPrefix = keyValue ? String(keyValue).substring(0, 10) + '...' : 'undefined'
  
  return new Response(JSON.stringify({
    envKeys: keys,
    hasContentOsKey,
    keyLength,
    keyPrefix,
    hasDB: 'DB' in env,
  }), {
    headers: { 'Content-Type': 'application/json' }
  })
}
