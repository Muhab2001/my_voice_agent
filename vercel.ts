const apiOrigin = process.env.RENDER_API_ORIGIN

if (!apiOrigin) {
  throw new Error('Set RENDER_API_ORIGIN to the HTTPS origin of the Render API')
}

const parsedApiOrigin = new URL(apiOrigin)

if (parsedApiOrigin.protocol !== 'https:' || parsedApiOrigin.pathname !== '/') {
  throw new Error('RENDER_API_ORIGIN must be an HTTPS origin without a path')
}

const origin = parsedApiOrigin.origin

export const config = {
  framework: 'vite',
  installCommand: 'bun install --frozen-lockfile --linker hoisted',
  buildCommand: 'bun run --cwd apps/web build',
  outputDirectory: 'apps/web/dist',
  rewrites: [
    { source: '/v1/:path*', destination: `${origin}/v1/:path*` },
    { source: '/health/:path*', destination: `${origin}/health/:path*` },
    { source: '/:path*', destination: '/index.html' },
  ],
}
