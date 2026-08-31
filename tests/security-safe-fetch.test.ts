import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's type-stripping test runner requires an explicit .ts extension.
import { assertSafeUrl, isForbiddenIp, isHttpUrl } from '../src/lib/safe-fetch.ts'

test('only HTTP(S) URLs are accepted', () => {
  assert.equal(isHttpUrl('https://example.com/path'), true)
  assert.equal(isHttpUrl('http://example.com'), true)
  assert.equal(isHttpUrl('file:///etc/passwd'), false)
  assert.equal(isHttpUrl('javascript:alert(1)'), false)
})

test('private, loopback, link-local, and reserved addresses are rejected', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.1.1', '192.0.2.1', '198.51.100.1', '203.0.113.1', '0.0.0.0', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isForbiddenIp(address), true, address)
  }
  assert.equal(isForbiddenIp('8.8.8.8'), false)
  assert.equal(isForbiddenIp('2606:4700:4700::1111'), false)
})

test('unsafe hosts and URL credentials fail closed', () => {
  for (const url of ['http://localhost', 'http://service.internal', 'http://127.0.0.1', 'https://user:pass@example.com']) {
    assert.throws(() => assertSafeUrl(url), Error, url)
  }
  assert.equal(assertSafeUrl('https://example.com').hostname, 'example.com')
})
