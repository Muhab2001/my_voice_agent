import { deploymentEnv, routes, type VercelConfig } from '@vercel/config/v1'

export const config: VercelConfig = {
  framework: 'vite',
  installCommand: 'bun install --frozen-lockfile --linker hoisted',
  buildCommand: 'bun run build',
  outputDirectory: 'dist',
  rewrites: [
    routes.rewrite('/v1/:path*', deploymentEnv('RENDER_API_ORIGIN')),
    routes.rewrite('/health/:path*', deploymentEnv('RENDER_API_ORIGIN')),
    routes.rewrite('/:path*', '/index.html'),
  ],
}
