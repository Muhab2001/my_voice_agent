import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export const DEFAULT_LIVE_MODEL = 'gpt-live-1'

export const voiceSessions = pgTable(
  'voice_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vendorSessionId: varchar('vendor_session_id', { length: 128 }),
    vendor: varchar('vendor', { length: 32 }).notNull().default('openai'),
    status: varchar('status', { length: 32 }).notNull().default('created'),
    model: varchar('model', { length: 128 })
      .notNull()
      .default(DEFAULT_LIVE_MODEL),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endReason: varchar('end_reason', { length: 128 }),
    finalization: varchar('finalization', { length: 32 }),
    usage: jsonb('usage'),
    error: text('error'),
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

export const transcriptSnapshots = pgTable(
  'transcript_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => voiceSessions.id),
    role: varchar('role', {
      length: 16,
      enum: ['user', 'assistant'],
    }).notNull(),
    text: text('text').notNull(),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('transcript_session_time_idx').on(
      table.sessionId,
      table.startMs,
      table.createdAt,
    ),
  ],
)

export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceSessionId: uuid('source_session_id')
      .notNull()
      .references(() => voiceSessions.id),
    content: text('content').notNull(),
    entity: varchar('entity', { length: 128 }),
    eventAt: timestamp('event_at', { withTimezone: true }),
    fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('memories_fingerprint_unique').on(table.fingerprint),
    index('memories_entity_event_idx').on(table.entity, table.eventAt),
  ],
)
