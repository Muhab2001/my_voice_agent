import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

export async function runMigrations(url: string): Promise<void> {
  const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))
  const pool = new pg.Pool({
    connectionString: url,
    connectionTimeoutMillis: 3000,
  })
  try {
    await migrate(drizzle(pool), { migrationsFolder })
  } finally {
    await pool.end()
  }
}
