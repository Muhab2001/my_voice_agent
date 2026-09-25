import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

export async function runMigrations(
  url: string,
  migrationsFolder: string,
): Promise<void> {
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
