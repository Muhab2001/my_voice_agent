import { expect, test } from 'bun:test'
import { memoryFingerprint, newDrizzleDatabase } from '@voice/database'
import { runMigrations } from '@voice/database/migrate'
import { MemoryService } from '../services/memory-service.js'
import { TranscriptService } from '../services/transcript-service.js'
import { VoiceSessionService } from '../services/voice-session-service.js'

const url = process.env.TEST_DATABASE_URL
// Opt in against a disposable database: migrations are applied, existing data is retained.
test.skipIf(!url)(
  'PostgreSQL migration, deduplication, literal keyword/entity/time lookup and in-place correction',
  async () => {
    if (!url) {
      throw new Error('TEST_DATABASE_URL required')
    }
    await runMigrations(url)
    const database = newDrizzleDatabase({ url })
    try {
      const memory = new MemoryService(database.client)
      const transcripts = new TranscriptService(database.client)
      const sessions = new VoiceSessionService(database.client)
      const session = await sessions.create()
      const tag = crypto.randomUUID()
      const original = {
        content: `I prefer tea ${tag}`,
        entity: tag,
        event_at: '2026-09-01T12:00:00Z',
      }
      const [first, duplicate] = await Promise.all([
        memory.remember(session, original),
        memory.remember(session, {
          ...original,
          content: ` I PREFER   tea ${tag} `,
        }),
      ])
      expect(first.id).toBe(duplicate.id)
      expect(memoryFingerprint(original)).toBe(
        memoryFingerprint({
          ...original,
          event_at: '2026-09-01T15:00:00+03:00',
        }),
      )
      const search = {
        query: `tea ${tag}`,
        entity: tag.toUpperCase(),
        from: '2026-09-01T00:00:00Z',
        to: '2026-09-02T00:00:00Z',
        limit: 5,
      }
      expect((await memory.search(search)).map((row) => row.id)).toEqual([
        first.id,
      ])
      expect(
        await memory.search({ ...search, from: '2026-09-02T00:00:00Z' }),
      ).toEqual([])
      expect(
        await memory.search({ ...search, entity: `missing-${tag}` }),
      ).toEqual([])
      expect(await memory.search({ ...search, query: '%' })).toEqual([])
      const corrected = await memory.correct(first.id, {
        ...original,
        content: `I prefer coffee ${tag}`,
      })
      expect(corrected.id).toBe(first.id)
      expect(await memory.search(search)).toEqual([])
      expect(
        (await memory.search({ ...search, query: `coffee ${tag}` }))[0].id,
      ).toBe(first.id)
      await expect(
        memory.correct(crypto.randomUUID(), original),
      ).rejects.toThrow('does not exist')
      const chunk = {
        id: crypto.randomUUID(),
        sessionId: session,
        role: 'user' as const,
        text: 'hello ',
        startMs: 0,
        endMs: 100,
      }
      await transcripts.append([chunk])
      await transcripts.append([
        chunk,
        {
          ...chunk,
          id: crypto.randomUUID(),
          role: 'assistant',
          text: 'hi',
          startMs: 100,
          endMs: 200,
        },
      ])
      const second = {
        ...chunk,
        id: crypto.randomUUID(),
        text: 'world',
        startMs: 50,
        endMs: 90,
      }
      const resumed = {
        ...chunk,
        id: crypto.randomUUID(),
        text: 'again',
        startMs: 200,
        endMs: 300,
      }

      // Insert out of timeline order and replay a committed batch.
      await transcripts.append([resumed, second])
      await transcripts.append([second])

      const merged = await transcripts.read(session)
      expect(merged.map((row) => row.text)).toEqual([
        'hello world',
        'hi',
        'again',
      ])
      expect(merged.map((row) => row.role)).toEqual([
        'user',
        'assistant',
        'user',
      ])
      expect(merged[0].id).toBe(chunk.id)
      expect(merged[0].startMs).toBe(0)
      expect(merged[0].endMs).toBe(100)

      // Identical speakers in a different session never join this conversation.
      const otherSession = await sessions.create()
      await transcripts.append([
        { ...chunk, id: crypto.randomUUID(), sessionId: otherSession },
      ])
      expect(
        (await transcripts.read(otherSession)).map((row) => row.text),
      ).toEqual(['hello '])
      expect(await transcripts.read(crypto.randomUUID())).toEqual([])
    } finally {
      await database.resource.close()
    }
  },
)
