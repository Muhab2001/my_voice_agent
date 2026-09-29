# Hotel reservation demo: implementation plan

This plan replaces the earlier workflow design. The feature is a voice-managed reservation draft that the customer can review and confirm in the browser. The server saves the reservation and returns its complete state after every change. There is no workflow definition table or configurable step engine.

## What the customer can do

1. Ask to make a reservation. The server immediately creates a `draft` reservation and returns its ID and current state. Details supplied in that first request can be saved at the same time.
2. Provide one field or several fields in any order: hotel location, stay date, room selections, and guest name. A room selection includes a room type and quantity, so the customer can reserve multiple rooms. The one-night total is the sum of `quantity × unit price` across the selections.
3. Ask for options for any field at any time. The agent answers that request and shows relevant choices. Hotel choices can be filtered by city and, when a date is known, by room availability on that date. At a natural pause, it suggests the first missing field in this order: hotel, date, rooms, guest name. It never chooses an option on the customer's behalf.
4. If a requested room type has no availability on the selected day, the agent explains that and offers available room types, another day, or another hotel. If the hotel has no available room types for that day, it asks the customer to change the day or hotel. Already supplied independent fields, such as the guest name, remain saved.
5. Review the complete reservation, including every room quantity, unit price, line total, and summed total. Only an explicit click on the browser Confirm button changes its status to `confirmed`. The agent has no confirmation tool.
6. Ask to see abandoned reservations. The agent shows the abandoned drafts and can resume a selected one. An unfinished draft becomes `abandoned` when the customer abandons it, starts a different reservation, or ends the session without confirming. Nothing is deleted automatically.
7. Ask to find reservations by criteria, such as “my upcoming reservations,” “reservations in Riyadh,” or “my Marriott reservations.” The customer can combine criteria, for example “upcoming Marriott reservations in Riyadh.” A lookup does not change the active draft.

## Data to store

| Table | Purpose | Main fields |
| --- | --- | --- |
| `hotels` | One row per hotel location, such as `Marriott - Al Khobar`. There is no separate branch table. | `id`, `brand_name`, `location_name`, `city`, `active` |
| `hotel_offerings` | Room types offered by one hotel location. | `id`, `hotel_id`, `name`, `price_sar`, `weekly_availability`, `active` |
| `reservations` | The customer's editable reservation and final confirmation. | `id`, `status`, `hotel_id`, `stay_date`, `guest_name`, `rooms`, `quoted_total_sar`, `confirmed_total_sar`, `revision`, timestamps |

`weekly_availability` is a seven-element Sunday-to-Saturday array of nonnegative room counts. During the initial dummy-data seed, each offering gets **one randomly chosen weekday with a count of 0** and positive counts for its other six days. The chosen values are stored and do not change on later seed runs or server restarts. Different offerings may happen to share the same unavailable weekday. The server uses the stay date's weekday in `Asia/Riyadh` to read the count. Availability repeats weekly; this demo does not track real inventory or reduce counts after confirmation.

`rooms` is an array on the reservation row. Each entry contains an offering ID, quantity, and server-supplied name and quoted unit price. There is at most one entry per offering; quantities are positive integers and cannot exceed that offering's availability for the selected day. The server calculates `quoted_total_sar` from these entries. A confirmed reservation preserves the accepted room details and `confirmed_total_sar`.

The app uses one shared password and a single reservation history. Authenticated browser reads and confirmation, and server-side voice tools, all use that history.

## Finding reservations

One read-only reservation search accepts optional `upcoming`, `city`, `brand`, and `status` filters. Supplied filters combine with **AND**. `upcoming` means a **confirmed** reservation with `stay_date` on or after today's date in `Asia/Riyadh`. A city matches the selected hotel's city by case-insensitive substring, so `khobar` matches `Al Khobar`. A brand matches its `brand_name` without regard to letter case or location name. The server uses the selected hotel’s city and brand for these filters across the shared reservation history. Without an explicit status or `upcoming`, searches show confirmed reservations; asking for abandoned reservations uses `status=abandoned`. For example, an agent search with `upcoming=true`, `city=riyadh`, and `brand=marriott` returns matching upcoming Marriott stays in Riyadh.

Results show the hotel location, stay date, status, room summary, and total. Upcoming results are ordered by nearest stay date; other results show the most recently updated first. The options card shows a short list with a way to load more. Opening a confirmed result shows read-only details there; the customer can ask the agent to resume an abandoned result. Searching or opening results never edits the current draft.

## Reservation behavior

The API service owns the state rules. It derives the next missing field from the saved reservation; it does not store a step number. One update may contain any subset of fields and is committed in one database transaction. Every successful create, update, abandon, resume, or confirmation returns the complete reservation with a higher `revision`.

- Changing the hotel or stay date clears previously selected rooms and the quote in that same update. If the request also supplies new rooms, the service validates those rooms against the new hotel and date and saves them together.
- Changing room quantities recalculates the quote. The service checks that every offering belongs to the chosen hotel and that its requested quantity is available on the chosen weekday.
- A hotel/date choice with no available rooms remains saved, with no room selections. If a batch also requests an unavailable room, the service saves its valid hotel, date, and guest-name fields, leaves rooms empty, and returns the availability reason. An unknown hotel or offering ID is a validation error and does not mutate the reservation.
- Confirmation requires a hotel, a stay date of today or later, at least one available room selection, a guest name, and a displayed total. The service rechecks availability and prices, then stores the confirmed total and status in one transaction. If the quote changed, it returns an updated draft for another explicit review instead of confirming silently.
- The agent updates the reservation service through server-side tools. After reviewing the full quote and receiving explicit customer agreement, the agent can confirm by voice; the browser Confirm button is another option. Writes include the last seen `revision`; a stale update receives the latest state rather than overwriting a newer edit.

An illustrative state returned after an update:

```json
{
  "id": "reservation-id",
  "status": "draft",
  "hotel": "Marriott - Al Khobar",
  "stayDate": "2026-10-02",
  "rooms": [
    { "name": "Double Bed", "quantity": 2, "unitPriceSar": 520, "lineTotalSar": 1040 },
    { "name": "Suite", "quantity": 1, "unitPriceSar": 770, "lineTotalSar": 770 }
  ],
  "guestName": null,
  "quotedTotalSar": 1810,
  "nextMissingField": "guestName",
  "revision": 3
}
```

The example values are illustrative; the real response also includes stable hotel and offering IDs. The next field is only a suggestion. The customer can still ask the agent to edit any field or show another option.

## Floating cards in the browser

- **Reservation progress card:** Appears after a reservation state event, above the options card. It shows saved fields, status, room quantities, total, and four small completion checkpoints. Each checkpoint changes from a gray empty circle to a green checked circle when its field is filled. The fields are read-only. Its Confirm action appears when the form is complete.
- **Options card:** Appears when the agent offers choices. Its single-line heading reflects the content: Hotels, Room options, Available dates, or Reservations. It shows hotel locations, a date/availability view, room types with prices and available counts, or filtered reservation results. The customer tells the agent which option to use; the agent saves it and refreshes the progress card. When there is no availability, this card explains the block and offers a different day or hotel. Search results and confirmed reservation details are read-only.

The options card is temporary display state; the reservation is persistent server state. Voice writes publish the new reservation snapshot through the existing voice UI event channel. Browser confirmation receives the same snapshot in the HTTP response. When the page reconnects, it fetches the reservation so a missed event cannot leave the progress card stale.

## API and agent actions

Keep the surface small:

- Browser HTTP: read the current reservation and confirm a complete draft.
- Agent tools call the reservation service directly to create, update, abandon, resume, inspect catalog options, and search reservations. A read-only options action may inspect any field, and a read-only reservation search handles lookup requests without changing the active draft. The agent suggests the next missing field after a saved update or conversational pause, answers an explicitly requested field first, and asks the customer to confirm in the browser.

Validate HTTP bodies, voice tool arguments, and incoming UI events with Zod. Resolve hotel and offering names to IDs on the server; if a name matches more than one row, show choices instead of guessing. Dates are resolved to an exact `Asia/Riyadh` calendar date before saving.

## Build and verify

1. Add the three tables and an idempotent dummy-data seed. Verify that each offering has one stable zero-availability weekday.
2. Add the reservation service and API. Check multi-field updates, room quantity limits, quote sums, clearing rooms after hotel/date edits, confirmation, abandoned/resume behavior, and combined reservation search filters.
3. Connect the voice tools and existing UI event channel. Build read-only progress and options cards with a browser Confirm action.
4. Smoke test spoken booking and clicked confirmation, asking for options out of order, unavailable weekdays, multiple rooms, explicit confirmation, session abandonment, listing/resuming abandoned reservations, and finding upcoming reservations by city and brand in the same browser.
