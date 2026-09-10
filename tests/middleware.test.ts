import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'

import { middleware } from '../src/middleware'

const ID = 'a1b2c3d4e5f60718'

function request(path: string, headers?: HeadersInit): NextRequest {
  return new NextRequest(`https://navsphere.test${path}`, { headers })
}

test('detail middleware distinguishes malformed, absent, unavailable, and present documents', async () => {
  const originalFetch = globalThis.fetch
  try {
    let calls = 0
    globalThis.fetch = async (_input, init) => {
      calls += 1
      assert.equal(init?.method, 'GET')
      return new Response(null, { status: 404 })
    }
    assert.equal((await middleware(request('/feed/not-an-id'))).status, 404)
    assert.equal(calls, 0)
    assert.equal((await middleware(request(`/feed/${ID}`))).status, 404)

    globalThis.fetch = async () => new Response(null, { status: 500 })
    assert.equal((await middleware(request(`/feed/${ID}`))).status, 503)

    globalThis.fetch = async () => { throw new Error('network unavailable') }
    assert.equal((await middleware(request(`/feed/${ID}`))).status, 503)

    globalThis.fetch = async () => new Response(null, { status: 200 })
    const present = await middleware(request(`/feed/${ID}`))
    assert.equal(present.headers.get('x-middleware-next'), '1')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('reserved and RSC feed requests bypass document existence checks', async () => {
  const originalFetch = globalThis.fetch
  try {
    let calls = 0
    globalThis.fetch = async () => { calls += 1; return new Response(null, { status: 404 }) }
    for (const path of ['/feed/daily', '/feed/hot', '/feed/topics']) {
      assert.equal((await middleware(request(path))).headers.get('x-middleware-next'), '1')
    }
    assert.equal((await middleware(request(`/feed/${ID}`, { RSC: '1' }))).headers.get('x-middleware-next'), '1')
    assert.equal((await middleware(request(`/feed/${ID}`, { 'Next-Router-Prefetch': '1' }))).headers.get('x-middleware-next'), '1')
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
