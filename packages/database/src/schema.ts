import {
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export const DEFAULT_REALTIME_MODEL = 'gpt-realtime-2.1'

export const voiceSessions = pgTable(
  'voice_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vendorSessionId: varchar('vendor_session_id', { length: 128 }),
    vendor: varchar('vendor', { length: 32 }).notNull().default('openai'),
    status: varchar('status', { length: 32 }).notNull().default('created'),
    model: varchar('model', { length: 128 })
      .notNull()
      .default(DEFAULT_REALTIME_MODEL),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endReason: varchar('end_reason', { length: 128 }),
  },
  (table) => [
    uniqueIndex('voice_sessions_vendor_session_unique').on(
      table.vendor,
      table.vendorSessionId,
    ),
    index('voice_sessions_status_started_at_idx').on(
      table.status,
      table.startedAt,
    ),
  ],
)
