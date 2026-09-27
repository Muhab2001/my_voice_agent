import { runMigrations } from '@voice/database/migrate'
import { loadScriptsEnv } from './env.js'

const { DATABASE_URL } = loadScriptsEnv()

await runMigrations(DATABASE_URL)
console.log('Database migrations complete')
