import { deploymentEnv, type VercelConfig } from '@vercel/config/v1'

export const config: VercelConfig = {
  framework: 'vite',
  installCommand: 'bun install --frozen-lockfile --linker hoisted',
  buildCommand: 'bun run build',
  outputDirectory: 'dist',
  routes: [
    {
      src: '^/v1/(.*)$',
      dest: `${deploymentEnv('RENDER_API_ORIGIN')}/v1/$1`,
      env: ['RENDER_API_ORIGIN'],
    },
    {
      src: '^/health/(.*)$',
      dest: `${deploymentEnv('RENDER_API_ORIGIN')}/health/$1`,
      env: ['RENDER_API_ORIGIN'],
    },
    { handle: 'filesystem' },
    { src: '^/.*$', dest: '/index.html' },
  ],
}
