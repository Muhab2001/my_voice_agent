import { sql } from 'drizzle-orm'
import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  pgView,
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

export const userLocation = pgTable(
  'user_location',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    accuracyMeters: doublePrecision('accuracy_meters').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('user_location_recorded_at_idx').on(table.recordedAt)],
)

export const hotels = pgTable(
  'hotels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    brandName: varchar('brand_name', { length: 128 }).notNull(),
    locationName: varchar('location_name', { length: 128 }).notNull(),
    city: varchar('city', { length: 128 }).notNull(),
    active: integer('active').notNull().default(1),
  },
  (table) => [
    uniqueIndex('hotels_location_unique').on(
      table.brandName,
      table.locationName,
    ),
  ],
)

export const hotelOfferings = pgTable(
  'hotel_offerings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hotelId: uuid('hotel_id')
      .notNull()
      .references(() => hotels.id),
    name: varchar('name', { length: 128 }).notNull(),
    priceSar: integer('price_sar').notNull(),
    weeklyAvailability: jsonb('weekly_availability')
      .$type<number[]>()
      .notNull(),
    active: integer('active').notNull().default(1),
  },
  (table) => [
    uniqueIndex('hotel_offerings_name_unique').on(table.hotelId, table.name),
  ],
)

export type StoredRoom = {
  offeringId: string
  name: string
  quantity: number
  unitPriceSar: number
}

export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    status: varchar('status', {
      length: 16,
      enum: ['draft', 'abandoned', 'confirmed'],
    })
      .notNull()
      .default('draft'),
    hotelId: uuid('hotel_id').references(() => hotels.id),
    stayDate: varchar('stay_date', { length: 10 }),
    guestName: varchar('guest_name', { length: 128 }),
    rooms: jsonb('rooms').$type<StoredRoom[]>().notNull().default([]),
    quotedTotalSar: integer('quoted_total_sar'),
    confirmedTotalSar: integer('confirmed_total_sar'),
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('reservations_status_idx').on(table.status),
    uniqueIndex('reservations_one_draft')
      .on(table.status)
      .where(sql`${table.status} = 'draft'`),
    index('reservations_date_idx').on(table.stayDate),
  ],
)

/** Read-only speaker passages assembled from persisted snapshots by the migration-defined view. */
export const mergedTranscripts = pgView('merged_transcripts', {
  id: uuid('id').notNull(),
  sessionId: uuid('session_id').notNull(),
  role: varchar('role', { length: 16, enum: ['user', 'assistant'] }).notNull(),
  text: text('text').notNull(),
  startMs: integer('start_ms').notNull(),
  endMs: integer('end_ms').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}).existing()
