/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone build for Cloudflare Pages
  // Note: Most routes use 'edge' runtime which is compatible with Cloudflare
  output: 'standalone',

  // Don't fail build on ESLint warnings
  eslint: {
    ignoreDuringBuilds: true,
  },

  images: {
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
  } catch (e) {
    console.warn('Cloudflare dev platform not available:', e.message)
  }
}

// Only setup dev platform in development
if (process.env.NODE_ENV === 'development') {
  setupDevPlatform()
}

module.exports = nextConfig
