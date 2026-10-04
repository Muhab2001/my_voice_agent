import { expect, test } from 'bun:test'
import {
  cityMatchesQuery,
  ReservationError,
  todayInBookingTimezone,
  weekdayForStayDate,
} from './reservation-service.js'

test('city matching accepts partial names and normalized whitespace', () => {
  expect(cityMatchesQuery('Al Khobar', 'khobar')).toBe(true)
  expect(cityMatchesQuery('Al   Khobar', ' al khO ')).toBe(true)
  expect(cityMatchesQuery('Al Khobar', 'riyadh')).toBe(false)
  expect(cityMatchesQuery('Al Khobar', '   ')).toBe(false)
})

test('stay dates follow the booking timezone and reject invalid dates', () => {
  expect(weekdayForStayDate('2026-10-01')).toBe(4)
  expect(todayInBookingTimezone(new Date('2026-09-30T22:30:00Z'))).toBe(
    '2026-10-01',
  )
  expect(() => weekdayForStayDate('2026-02-30')).toThrow(ReservationError)
})
