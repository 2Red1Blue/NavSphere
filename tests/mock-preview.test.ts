import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MOCK_PREVIEW_BUILD,
  resolveMockPreviewKey,
} from '../src/lib/mock-preview'

test('production gate ignores ?mock_v2= entirely, as if the parameter did not exist', () => {
  // In production builds the constant folds to false; the resolver must
  // return null for every possible query, never a preview key.
  assert.equal(resolveMockPreviewKey('?mock_v2=brief', false), null)
  assert.equal(resolveMockPreviewKey('?mock_v2=explainer', false), null)
  assert.equal(resolveMockPreviewKey('?mock_v2=feature', false), null)
  assert.equal(resolveMockPreviewKey('?mock_v2=', false), null)
  assert.equal(resolveMockPreviewKey('?other=1&mock_v2=brief', false), null)
  assert.equal(resolveMockPreviewKey('', false), null)
})

test('non-production gate resolves explicit keys and tolerates absent values', () => {
  assert.equal(resolveMockPreviewKey('?mock_v2=brief', true), 'brief')
  assert.equal(resolveMockPreviewKey('?mock_v2=explainer', true), 'explainer')
  assert.equal(resolveMockPreviewKey('?a=1&mock_v2=brief', true), 'brief')
  // Empty, absent, and unknown values yield no preview; no synthetic article
  // is created until a known key has been accepted.
  assert.equal(resolveMockPreviewKey('?mock_v2=', true), null)
  assert.equal(resolveMockPreviewKey('?other=1', true), null)
  assert.equal(resolveMockPreviewKey('?mock_v2=feature', true), null)
})

test('build constant tracks the compile-time NODE_ENV fold', () => {
  assert.equal(MOCK_PREVIEW_BUILD, process.env.NODE_ENV !== 'production')
})
