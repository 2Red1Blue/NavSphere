import type { Session } from 'next-auth'
import type { NextResponse } from 'next/server'

export function parseAdminLogins(value: string | undefined): Set<string> {
  return new Set((value ?? '').split(',').map((login) => login.trim().toLocaleLowerCase('en-US')).filter(Boolean))
}

export function isAdminLogin(login: string | null | undefined, allowlist = process.env.ADMIN_GITHUB_LOGINS): boolean {
  return Boolean(login && parseAdminLogins(allowlist).has(login.trim().toLocaleLowerCase('en-US')))
}

export function isAdminSession(session: Session | null): session is Session & { user: NonNullable<Session['user']> } {
  return Boolean(session?.user && isAdminLogin(session.user.login))
}

type AdminResult =
  | { ok: true; session: Session & { user: NonNullable<Session['user']> } }
  | { ok: false; response: NextResponse }

export async function requireAdmin(): Promise<AdminResult> {
  const [{ auth }, { NextResponse }] = await Promise.all([
    import('@/lib/auth'),
    import('next/server'),
  ])
  const session = await auth()
  if (!session?.user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!isAdminSession(session)) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true, session }
}
