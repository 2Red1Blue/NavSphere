import NextAuth from 'next-auth'
import GithubProvider from 'next-auth/providers/github'
import type { DefaultSession, NextAuthConfig } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: { login?: string } & DefaultSession['user']
  }
}

const config = {
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: { params: { scope: 'read:user user:email' } },
    }),
  ],
  callbacks: {
    async jwt({ token, profile }) {
      if (profile && typeof profile.login === 'string') token.githubLogin = profile.login
      return token
    },
    async session({ session, token }) {
      if (session.user && typeof token.githubLogin === 'string') session.user.login = token.githubLogin
      return session
    },
  },
  pages: { signIn: '/auth/signin' },
  secret: process.env.AUTH_SECRET,
} satisfies NextAuthConfig

const handler = NextAuth(config)
export const auth = handler.auth
export const { handlers: { GET, POST } } = handler
