/**
 * Compile-time gate for the Editorial v2 mock preview entry (`?mock_v2=`).
 *
 * Next.js statically replaces `process.env.NODE_ENV` with the build-type
 * literal at compile time, so `MOCK_PREVIEW_BUILD` folds to a constant:
 * `true` in dev/test builds, `false` in production builds. The page keeps the
 * guard inline as `process.env.NODE_ENV !== 'production'` (not just this
 * constant) so the bundler's dead-branch elimination drops the whole mock
 * branch — including the dynamic `__fixtures__` import and every placeholder
 * string — from production bundles.
 *
 * Mock fixtures are 【占位】 placeholder copy and must never be reachable in
 * production; there the parameter is ignored entirely and the page follows
 * the normal v1/v2 dispatch as if the parameter did not exist.
 */
export const MOCK_PREVIEW_BUILD: boolean = process.env.NODE_ENV !== 'production'

// Keep this allowlist independent from the fixture module. Unknown query
// values therefore never create a synthetic article before the dynamic import
// has proven a known preview was requested.
const MOCK_PREVIEW_KEYS = new Set(['brief', 'explainer'])

/**
 * Pure resolver for the `?mock_v2=` preview key. The build gate is injectable
 * so unit tests can pin the production constant and assert the parameter is
 * ignored. Returns null when the gate is closed (production) or when the
 * parameter is absent/empty; unknown keys are filtered by the fixtures
 * loader (fail-closed), not here.
 */
export function resolveMockPreviewKey(
  search: string,
  mockPreviewBuild: boolean = MOCK_PREVIEW_BUILD,
): string | null {
  if (!mockPreviewBuild) return null
  const key = new URLSearchParams(search).get('mock_v2')
  return key !== null && MOCK_PREVIEW_KEYS.has(key) ? key : null
}
