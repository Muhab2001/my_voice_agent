import { expect, test } from 'bun:test'
import type { voiceUiEventSchema } from '@voice/contracts'
import type { z } from 'zod'
import { TestReservationService } from '../testing/voice-fixture.js'
import { executeReservationTool } from './tools.js'
import { UIEventChannel } from './ui-event-channel.js'

test('date options show seven dates without changing the draft', async () => {
  const service = new TestReservationService()
  const hotelId = crypto.randomUUID()
  service.hotelOptions = [
    {
      id: hotelId,
      brandName: 'Marriott',
      locationName: 'Marriott - Riyadh',
      city: 'Riyadh',
    },
  ]
  service.offeringOptions = [
    {
      id: crypto.randomUUID(),
      hotelId,
      name: 'King Room',
      priceSar: 420,
      available: 2,
    },
  ]
  const ui = new UIEventChannel()
  const events: z.infer<typeof voiceUiEventSchema>[] = []
  ui.subscribe(
    'session',
    (event) => events.push(event),
    () => {},
  )

  const result = await executeReservationTool(
    service,
    ui,
    'session',
    'reservation_options',
    JSON.stringify({
      field: 'date',
      city: null,
      hotel_name: 'Marriott - Riyadh',
      stay_date: '2026-10-02',
    }),
  )

  const expectedOptions = Array.from({ length: 7 }, (_, offset) => ({
    date: new Date(Date.UTC(2026, 9, 2 + offset)).toISOString().slice(0, 10),
    availableRooms: 2,
  }))

  expect(result).toEqual({ options: expectedOptions })
  expect(events).toEqual([
    { type: 'reservation-options', kind: 'dates', options: expectedOptions },
  ])
  expect(service.rows.size).toBe(0)
})

test('hotel options filter by city and exact date availability', async () => {
  const service = new TestReservationService()
  const riyadh = crypto.randomUUID()
  const riyadhFull = crypto.randomUUID()
  const khobar = crypto.randomUUID()
  service.hotelOptions = [
    {
      id: riyadh,
      brandName: 'Marriott',
      locationName: 'Marriott - Riyadh',
      city: 'Riyadh',
    },
    {
      id: riyadhFull,
      brandName: 'Hilton',
      locationName: 'Hilton - Riyadh',
      city: 'Riyadh',
    },
    {
      id: khobar,
      brandName: 'Marriott',
      locationName: 'Marriott - Al Khobar',
      city: 'Al Khobar',
    },
  ]
  service.offeringOptions = [
    {
      id: crypto.randomUUID(),
      hotelId: riyadh,
      name: 'King',
      priceSar: 400,
      available: 2,
    },
    {
      id: crypto.randomUUID(),
      hotelId: riyadhFull,
      name: 'King',
      priceSar: 400,
      available: 0,
    },
    {
      id: crypto.randomUUID(),
      hotelId: khobar,
      name: 'King',
      priceSar: 400,
      available: 3,
    },
  ]
  const ui = new UIEventChannel()

  const available = await executeReservationTool(
    service,
    ui,
    'session',
    'reservation_options',
    JSON.stringify({
      field: 'hotel',
      city: 'RIYADH',
      hotel_name: null,
      stay_date: '2026-10-02',
    }),
  )
  expect(available).toEqual({ options: [service.hotelOptions[0]] })

  const otherCity = await executeReservationTool(
    service,
    ui,
    'session',
    'reservation_options',
    JSON.stringify({
      field: 'hotel',
      city: 'khobar',
      hotel_name: null,
      stay_date: null,
    }),
  )
  expect(otherCity).toEqual({ options: [service.hotelOptions[2]] })
  expect(service.rows.size).toBe(0)

  const cityNameAsHotel = await executeReservationTool(
    service,
    ui,
    'session',
    'reservation_options',
    JSON.stringify({
      field: 'hotel',
      city: null,
      hotel_name: 'Khobar',
      stay_date: null,
    }),
  )
  expect(cityNameAsHotel).toEqual({ options: [service.hotelOptions[2]] })

  const draft = await executeReservationTool(
    service,
    ui,
    'session',
    'start_reservation',
    JSON.stringify({
      hotel_name: 'Riyadh',
      stay_date: null,
      guest_name: null,
      rooms: null,
    }),
  )
  expect(draft).toMatchObject({
    reservation: { hotelId: null },
    choices: [service.hotelOptions[0], service.hotelOptions[1]],
  })

  const khobarDraft = await executeReservationTool(
    service,
    ui,
    'session',
    'start_reservation',
    JSON.stringify({
      hotel_name: 'Khobar',
      stay_date: null,
      guest_name: null,
      rooms: null,
    }),
  )
  expect(khobarDraft).toMatchObject({
    reservation: { hotelId: null },
    choices: [service.hotelOptions[2]],
  })
})

test('ambiguous hotel name creates an unassigned draft and presents choices', async () => {
  const service = new TestReservationService()
  service.hotelOptions = [
    {
      id: crypto.randomUUID(),
      brandName: 'Marriott',
      locationName: 'Marriott - Riyadh',
      city: 'Riyadh',
    },
    {
      id: crypto.randomUUID(),
      brandName: 'Marriott',
      locationName: 'Marriott - Al Khobar',
      city: 'Al Khobar',
    },
  ]
  const ui = new UIEventChannel()

  const result = await executeReservationTool(
    service,
    ui,
    'session',
    'start_reservation',
    JSON.stringify({
      hotel_name: 'Marriott',
      stay_date: null,
      guest_name: 'Amina',
      rooms: null,
    }),
  )

  expect(result).toMatchObject({
    reservation: { hotelId: null, guestName: 'Amina' },
    choices: service.hotelOptions,
  })
})

test('agent confirmation publishes confirmed state and leaves a changed quote for review', async () => {
  const service = new TestReservationService()
  const draft = await service.create()
  const ui = new UIEventChannel()
  const events: z.infer<typeof voiceUiEventSchema>[] = []
  ui.subscribe(
    'session',
    (event) => events.push(event),
    () => {},
  )
  let quoteChanged = true
  service.confirm = async (id, revision) => {
    expect(id).toBe(draft.id)
    const current = await service.get(id)
    expect(current?.revision).toBe(revision)

    if (!current) {
      throw new Error('Reservation missing')
    }

    const updated = {
      ...current,
      status: quoteChanged ? ('draft' as const) : ('confirmed' as const),
      reason: quoteChanged ? 'Price changed. Review the updated quote.' : null,
      revision: revision + 1,
    }
    service.rows.set(id, updated)
    quoteChanged = false
    return updated
  }

  const changed = await executeReservationTool(
    service,
    ui,
    'session',
    'reservation_action',
    JSON.stringify({
      action: 'confirm',
      reservation_id: draft.id,
      revision: 1,
    }),
  )
  expect(changed).toMatchObject({
    reservation: {
      status: 'draft',
      revision: 2,
      reason: 'Price changed. Review the updated quote.',
    },
  })

  const confirmed = await executeReservationTool(
    service,
    ui,
    'session',
    'reservation_action',
    JSON.stringify({
      action: 'confirm',
      reservation_id: draft.id,
      revision: 2,
    }),
  )
  expect(confirmed).toMatchObject({
    reservation: { status: 'confirmed', revision: 3 },
  })
  expect(
    events.filter((event) => event.type === 'reservation-state'),
  ).toHaveLength(2)
})
