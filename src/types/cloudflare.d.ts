// Cloudflare Pages type declarations
// Provides types for D1 bindings, environment variables, and @cloudflare/next-on-pages

// D1 Database types (subset of @cloudflare/workers-types)
interface D1Result<T = unknown> {
  results: T[]
  success: boolean
  meta: Record<string, unknown>
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = unknown>(colName?: string): Promise<T | null>
  all<T = unknown>(): Promise<D1Result<T>>
  run(): Promise<D1Result>
  raw<T = unknown>(): Promise<T[]>
}

interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>
  exec(query: string): Promise<D1Result>
}

// Cloudflare Pages environment augmentation
interface CloudflareEnv {
  DB: D1Database
  CONTENT_OS_API_KEY?: string
}

// @cloudflare/next-on-pages getRequestContext
declare module '@cloudflare/next-on-pages' {
  interface RequestContext {
    env: CloudflareEnv
    cf: Record<string, unknown>
    ctx: { waitUntil(promise: Promise<unknown>): void }
  }
  export function getRequestContext(): RequestContext
}