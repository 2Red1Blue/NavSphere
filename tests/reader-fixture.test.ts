import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import test from 'node:test'
import type { AddressInfo } from 'node:net'
import { createServer } from 'node:net'

import type { Article } from '../src/types/feed'

const IMAGE_URL = 'https://images.example.test/reader-fixture.png'
const ARTICLE_URL = 'https://source.example.test/articles/reader-fixture'

const fulltextFixture: Article = {
  url_hash: 'reader-fulltext-fixture',
  title: 'Reader fixture article',
  summary: 'This is the short AI guide.',
  takeaway: 'A local fixture exercises the reader contract without D1 writes.',
  source: 'Fixture source',
  url: ARTICLE_URL,
  category: 'general',
  type: 'deep',
  score: 27,
  signal: 9,
  novelty: 9,
  usefulness: 9,
  content_potential: 'High',
  published_at: '2026-09-02T00:00:00Z',
  discovered_at: '2026-09-02T00:00:00Z',
  created_at: '2026-09-02T00:00:00Z',
  content: [
    '# Reader fixture article',
    '',
    '## First section',
    '',
    'A paragraph with a [safe external source](https://external.example.test/read).',
    '',
    `![Consent image](${IMAGE_URL})`,
    '',
    '### Nested section',
    '',
    'Markdown headings and a local table of contents should remain usable.',
    '',
    '## AI 摘要',
    '',
    'This is the short AI guide.',
  ].join('\n'),
  content_format: 'markdown_v1',
  content_quality: 'verified_fulltext',
  fulltext_publication_allowed: true,
}

const fallbackFixture: Article = {
  ...fulltextFixture,
  url_hash: 'reader-fallback-fixture',
  content: null,
  content_format: null,
  content_quality: 'summary_only',
  fulltext_publication_allowed: false,
}

type Browser = {
  newPage(options?: { viewport?: { width: number; height: number } }): Promise<Page>
  close(): Promise<void>
}

type Page = {
  route(url: string, handler: (route: Route) => Promise<void>): Promise<void>
  on(event: string, handler: (request: Request) => void): void
  goto(url: string, options?: { waitUntil?: string }): Promise<unknown>
  reload(options?: { waitUntil?: string }): Promise<unknown>
  setViewportSize(size: { width: number; height: number }): Promise<void>
  getByRole(role: string, options: { name: string | RegExp }): Locator
  getByText(text: string, options?: { exact?: boolean }): Locator
  locator(selector: string, options?: { hasText?: string | RegExp }): Locator
  waitForRequest(urlOrPredicate: string | ((request: Request) => boolean), options?: { timeout?: number }): Promise<Request>
  evaluate<T>(pageFunction: () => T): Promise<T>
}

type Locator = {
  count(): Promise<number>
  isVisible(): Promise<boolean>
  getAttribute(name: string): Promise<string | null>
  allTextContents(): Promise<string[]>
  click(): Promise<void>
  waitFor(options?: { state?: string; timeout?: number }): Promise<void>
  scrollIntoViewIfNeeded(): Promise<void>
}

type Request = { url(): string }
type Route = { fulfill(options: { status: number; contentType: string; body: string }): Promise<void> }
type PlaywrightRuntime = { chromium: { launch(options: { headless: boolean }): Promise<Browser> } }

function loadOptionalPlaywright(): PlaywrightRuntime | null {
  const require = createRequire(import.meta.url)
  const candidates = [
    process.env.READER_PLAYWRIGHT_MODULE,
    '/opt/homebrew/lib/node_modules/playwright',
    '/usr/local/lib/node_modules/playwright',
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    try {
      return require(candidate) as PlaywrightRuntime
    } catch {
      // The repository intentionally does not add a browser framework dependency.
    }
  }
  return null
}

async function findFreePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

async function waitForDevServer(url: string, output: string[], timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.status < 500) return
    } catch {
      // Next is still compiling or binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Next dev server did not become ready.\n${output.join('')}`)
}

function startDevServer(port: number): { process: ReturnType<typeof spawn>; output: string[] } {
  const output: string[] = []
  const child = spawn('pnpm', ['dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()))
  return { process: child, output }
}

function articleResponse(article: Article): string {
  return JSON.stringify({ data: article })
}

test('reader production source preserves the local fixture acceptance contract', () => {
  const source = readFileSync(new URL('../src/app/feed/[id]/page.tsx', import.meta.url), 'utf8')

  assert.match(source, /if \(!consented\)/)
  assert.match(source, /为保护阅读隐私，本站不会自动连接/)
  assert.match(source, /loading="lazy"/)
  assert.match(source, /referrerPolicy="no-referrer"/)
  assert.match(source, /target=\{opensNewTab \? '_blank' : undefined\}/)
  assert.match(source, /rel=\{opensNewTab \? 'noopener noreferrer' : undefined\}/)
  assert.match(source, /aria-label="文章目录"/)
  assert.match(source, /hidden w-56 shrink-0 self-start xl:block/)
  assert.match(source, /canRenderFullContent\(article\)/)
  assert.match(source, /本站暂不展示完整原文/)
})

test('reader local fixture renders fulltext/fallback and responsive privacy behavior', async (context) => {
  const playwright = loadOptionalPlaywright()
  if (!playwright) {
    context.skip('Browser acceptance skipped: Playwright is not installed; source contract test still ran.')
    return
  }

  const port = await findFreePort()
  const { process: server, output } = startDevServer(port)
  const browser = await (async () => {
    try {
      await waitForDevServer(`http://127.0.0.1:${port}/feed/reader-fulltext-fixture`, output)
      return await playwright.chromium.launch({ headless: true })
    } catch (error) {
      server.kill('SIGTERM')
      context.skip(`Browser acceptance skipped: local Next/Chromium unavailable (${String(error)}).`)
      return null
    }
  })()

  if (!browser) return

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    let fixtureMode: 'fulltext' | 'fallback' = 'fulltext'
    const thirdPartyRequests: string[] = []

    await page.route('**/api/feed/reader-fulltext-fixture', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: articleResponse(fixtureMode === 'fulltext' ? fulltextFixture : fallbackFixture),
      })
    })
    await page.route(IMAGE_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>',
      })
    })
    page.on('request', (request) => {
      if (request.url() === IMAGE_URL) thirdPartyRequests.push(request.url())
    })

    await page.goto(`http://127.0.0.1:${port}/feed/reader-fulltext-fixture`, { waitUntil: 'domcontentloaded' })
    await page.locator('article .prose h2', { hasText: 'First section' }).waitFor({ state: 'visible', timeout: 15_000 })

    assert.equal(await page.locator('article .prose h2', { hasText: 'First section' }).getAttribute('id'), 'first-section')
    assert.equal(await page.locator('article .prose h3', { hasText: 'Nested section' }).getAttribute('id'), 'nested-section')
    assert.equal(await page.locator('nav[aria-label="文章目录"]').isVisible(), true, 'TOC is visible at 1280px')
    assert.deepEqual(
      await page.locator('nav[aria-label="文章目录"] a').allTextContents(),
      ['First section', 'Nested section'],
    )

    const externalLink = page.locator('article .prose a[href="https://external.example.test/read"]')
    assert.equal(await externalLink.getAttribute('target'), '_blank')
    assert.deepEqual((await externalLink.getAttribute('rel') ?? '').split(/\s+/).sort(), ['noopener', 'noreferrer'])

    assert.equal(thirdPartyRequests.length, 0, 'third-party image is not requested before consent')
    const loadOriginal = page.getByRole('button', { name: '加载原图' })
    assert.equal(await loadOriginal.isVisible(), true)
    const imageRequest = page.waitForRequest(
      (request) => request.url() === IMAGE_URL,
      { timeout: 5_000 },
    ).catch(() => null)
    await loadOriginal.click()
    const consentedImage = page.locator(`img[src="${IMAGE_URL}"]`)
    await consentedImage.waitFor({ state: 'attached', timeout: 3_000 })
    await consentedImage.scrollIntoViewIfNeeded()
    assert.ok(await imageRequest, 'third-party image may request only after consent')
    assert.equal(await consentedImage.getAttribute('referrerpolicy'), 'no-referrer')
    assert.equal(await consentedImage.getAttribute('loading'), 'lazy')

    await page.setViewportSize({ width: 390, height: 844 })
    assert.equal(await page.locator('nav[aria-label="文章目录"]').isVisible(), false, 'TOC is hidden on mobile')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'mobile reader has no horizontal overflow')

    fixtureMode = 'fallback'
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: '本站暂不展示完整原文' }).waitFor({ state: 'visible', timeout: 15_000 })
    assert.equal(await page.locator('[aria-labelledby="reader-fallback-title"]').isVisible(), true)
    assert.equal(await page.locator('article .prose').count(), 0)
    assert.equal(await page.getByRole('button', { name: '加载原图' }).count(), 0)
  } finally {
    await browser.close()
    server.kill('SIGTERM')
  }
})
