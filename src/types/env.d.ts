declare namespace NodeJS {
  interface ProcessEnv {
    NEXTAUTH_URL: string
    AUTH_SECRET: string
    GITHUB_CLIENT_ID: string
    GITHUB_CLIENT_SECRET: string
    GITHUB_OWNER: string
    GITHUB_REPO: string
    GITHUB_BRANCH: string
    GITHUB_PAT: string
    ADMIN_GITHUB_LOGINS: string
    SUBMISSION_RATE_LIMIT_PER_HOUR?: string
  }
}
