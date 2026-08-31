const fs = require('node:fs')
const path = require('node:path')

function loadProjectEnv() {
  const envPath = path.resolve(__dirname, '..', '.env')
  if (!fs.existsSync(envPath)) return

  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

loadProjectEnv()

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone build for Cloudflare Pages
  // Note: Most routes use 'edge' runtime which is compatible with Cloudflare
  output: 'standalone',

  images: {
    // User-managed navigation items can point at arbitrary remote icons. Keep
    // those requests in the browser instead of turning Next's optimizer into
    // a server-side fetch proxy.
    unoptimized: true,
    domains: [
      'dash.cloudflare.com',
      'www.google.com',
      'ph-static.imgix.net',
      'app.leonardo.ai'
    ],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/api/auth/:path*',
        destination: '/api/auth/:path*'
      },
      {
        source: '/auth/:path*',
        destination: '/auth/:path*'
      }
    ]
  },
  // Cloudflare Pages configuration
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost', 'newkit.site']
    },
    optimizePackageImports: ['lucide-react', 'date-fns', 'lodash']
  }
}

// Setup Cloudflare dev platform for local development
async function setupDevPlatform() {
  try {
    const { setupDevPlatform } = await import('@cloudflare/next-on-pages/next-dev')
    await setupDevPlatform()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('Cloudflare dev platform not available:', message)
  }
}

// Only setup dev platform in development
if (process.env.NODE_ENV === 'development') {
  setupDevPlatform()
}

module.exports = nextConfig
