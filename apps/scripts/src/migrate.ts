import { fileURLToPath } from 'node:url'
import { runMigrations } from '@voice/database/migrate'
import { loadScriptsEnv } from './env.js'

const { DATABASE_URL } = loadScriptsEnv()
const folder = fileURLToPath(
  new URL('../../../packages/database/drizzle', import.meta.url),
)

await runMigrations(DATABASE_URL, folder)
console.log('Database migrations complete')
