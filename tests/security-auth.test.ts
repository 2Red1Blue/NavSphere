import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's type-stripping test runner requires an explicit .ts extension.
import { isAdminLogin, parseAdminLogins } from '../src/lib/admin-auth.ts'

test('admin allowlist is trimmed and case-insensitive', () => {
  assert.deepEqual([...parseAdminLogins(' Alice,BOB ,, ')], ['alice', 'bob'])
  assert.equal(isAdminLogin('alice', 'ALICE,bob'), true)
  assert.equal(isAdminLogin('BoB', 'alice,bob'), true)
  assert.equal(isAdminLogin('mallory', 'alice,bob'), false)
})

test('an empty allowlist fails closed', () => {
  assert.equal(isAdminLogin('alice', ''), false)
  assert.equal(isAdminLogin(undefined, 'alice'), false)
})
