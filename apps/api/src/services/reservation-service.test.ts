import { expect, test } from 'bun:test'
import {
  newDrizzleDatabase,
  ReservationError,
  todayInBookingTimezone,
  weekdayForStayDate,
} from '@voice/database'
import { runMigrations } from '@voice/database/migrate'
import { hotelOfferings } from '@voice/database/schema'
import { eq } from 'drizzle-orm'
import { ReservationService } from './reservation-service.js'

function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Expected test fixture value')
  }

  return value
}

const url = process.env.RESERVATION_TEST_DATABASE_URL
const integration = url ? test : test.skip

integration('reservation state transitions and combined searches', async () => {
  if (!url) {
    return
  }

  await runMigrations(url)
  const database = newDrizzleDatabase({ url })

  try {
    const service = new ReservationService(database.client)
    const seeded = await database.client.select().from(hotelOfferings)
    expect(seeded).toHaveLength(12)

    for (const offering of seeded) {
      expect(offering.weeklyAvailability).toHaveLength(7)
      expect(
        offering.weeklyAvailability.filter((count) => count === 0),
      ).toHaveLength(1)
    }

    await runMigrations(url)
    const seededAgain = await database.client.select().from(hotelOfferings)
    expect(seededAgain).toEqual(seeded)
    const hotels = await service.hotels()
    const riyadh = required(
      hotels.find(
        (hotel) => hotel.brandName === 'Marriott' && hotel.city === 'Riyadh',
      ),
    )
    const khobar = required(hotels.find((hotel) => hotel.city === 'Al Khobar'))
    expect(riyadh).toBeDefined()
    expect(khobar).toBeDefined()

    const draft = await service.create({ guestName: 'Amina' })
    expect(draft.nextMissingField).toBe('hotel')
    expect(await service.get(crypto.randomUUID())).toBeNull()

    const dates = Array.from({ length: 14 }, (_, offset) => {
      const date = new Date(Date.now() + (offset + 2) * 86_400_000)
      return date.toISOString().slice(0, 10)
    })
    const readyDate = required(
      (
        await Promise.all(
          dates.map(async (date) => ({
            date,
            rooms: await service.offerings(riyadh.id, date),
          })),
        )
      ).find(
        (item) => item.rooms.filter((room) => room.available > 0).length >= 2,
      ),
    )
    expect(readyDate).toBeDefined()
    const available = readyDate.rooms
      .filter((room) => room.available > 0)
      .slice(0, 2)
    let state = await service.update(draft.id, {
      revision: draft.revision,
      hotelId: riyadh.id,
      stayDate: readyDate.date,
      rooms: available.map((room, index) => ({
        offeringId: room.id,
        quantity: index + 1,
      })),
    })
    expect(state.guestName).toBe('Amina')
    expect(state.rooms).toHaveLength(2)
    expect(state.quotedTotalSar).toBe(
      required(available[0]).priceSar + 2 * required(available[1]).priceSar,
    )
    expect(state.nextMissingField).toBeNull()

    await expect(
      service.update(draft.id, {
        revision: draft.revision,
        guestName: 'Stale',
      }),
    ).rejects.toMatchObject({ code: 'conflict' })
    await expect(
      service.update(crypto.randomUUID(), {
        revision: state.revision,
        guestName: 'Unknown reservation',
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      service.update(draft.id, {
        revision: state.revision,
        hotelId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'invalid' })
    expect((await service.get(draft.id))?.revision).toBe(state.revision)

    state = await service.update(draft.id, {
      revision: state.revision,
      hotelId: khobar.id,
    })
    expect(state.rooms).toEqual([])
    expect(state.quotedTotalSar).toBeNull()
    expect(state.guestName).toBe('Amina')
    state = await service.update(draft.id, {
      revision: state.revision,
      hotelId: riyadh.id,
      rooms: [{ offeringId: required(available[0]).id, quantity: 1 }],
    })
    expect(state.rooms).toHaveLength(1)

    const zero = required(
      (
        await Promise.all(
          dates.map(async (date) => ({
            date,
            rooms: await service.offerings(riyadh.id, date),
          })),
        )
      ).find((item) => item.rooms.some((room) => room.available === 0)),
    )
    const unavailable = required(
      zero.rooms.find((room) => room.available === 0),
    )
    state = await service.update(draft.id, {
      revision: state.revision,
      stayDate: zero.date,
      rooms: [{ offeringId: unavailable.id, quantity: 1 }],
      guestName: 'Amina B',
    })
    expect(state.stayDate).toBe(zero.date)
    expect(state.guestName).toBe('Amina B')
    expect(state.rooms).toEqual([])
    expect(state.reason).toContain('insufficient availability')
    await expect(
      service.confirm(draft.id, state.revision),
    ).rejects.toMatchObject({ code: 'invalid' })

    state = await service.update(draft.id, {
      revision: state.revision,
      stayDate: readyDate.date,
      rooms: [{ offeringId: required(available[0]).id, quantity: 1 }],
    })
    const oldPrice = required(available[0]).priceSar
    await database.client
      .update(hotelOfferings)
      .set({ priceSar: oldPrice + 30 })
      .where(eq(hotelOfferings.id, required(available[0]).id))
    const revised = await service.confirm(draft.id, state.revision)
    expect(revised.status).toBe('draft')
    expect(revised.quotedTotalSar).toBe(oldPrice + 30)
    expect(revised.reason).toContain('Review')
    const confirmed = await service.confirm(draft.id, revised.revision)
    expect(confirmed.status).toBe('confirmed')
    expect(confirmed.confirmedTotalSar).toBe(oldPrice + 30)
    await database.client
      .update(hotelOfferings)
      .set({ priceSar: oldPrice })
      .where(eq(hotelOfferings.id, required(available[0]).id))

    expect(
      (
        await service.list({
          upcoming: true,
          city: '  IYADH  ',
          brand: 'marriott',
        })
      ).map((item) => item.id),
    ).toContain(draft.id)
    expect(
      await service.list({
        upcoming: true,
        city: 'Jeddah',
        brand: 'marriott',
      }),
    ).toEqual([])
    expect(await service.list({ upcoming: true, city: 'Nowhere' })).toEqual([])
    expect(await service.list({ upcoming: true, status: 'abandoned' })).toEqual(
      [],
    )

    const abandoned = await service.create({
      guestName: 'Another guest',
    })
    const next = await service.create()
    const listed = await service.list({ status: 'abandoned' })
    expect(listed.map((item) => item.id)).toContain(abandoned.id)
    const resumed = await service.resume(
      abandoned.id,
      required(listed.find((item) => item.id === abandoned.id)).revision,
    )
    expect(resumed.status).toBe('draft')
    expect((await service.get(next.id))?.status).toBe('abandoned')
    await expect(
      service.resume(crypto.randomUUID(), next.revision),
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(weekdayForStayDate('2026-10-01')).toBe(4)
    expect(todayInBookingTimezone(new Date('2026-09-30T22:30:00Z'))).toBe(
      '2026-10-01',
    )
    expect(() => weekdayForStayDate('2026-02-30')).toThrow(ReservationError)
  } finally {
    await database.resource.close()
  }
})
