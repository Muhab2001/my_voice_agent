import type { placeCategorySchema } from '@voice/contracts'
import type { Coordinates } from '@voice/database'
import { z } from 'zod'

type PlaceCategory = z.infer<typeof placeCategorySchema>

const googleResponse = z.object({
  places: z
    .array(
      z.object({
        id: z.string(),
        displayName: z.object({ text: z.string() }),
        formattedAddress: z.string().optional(),
        googleMapsUri: z.string().url().optional(),
      }),
    )
    .optional(),
  routingSummaries: z
    .array(
      z.object({
        legs: z
          .array(
            z.object({
              distanceMeters: z.number().optional(),
              duration: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
})

export type Place = {
  name: string
  address: string
  url: string
  distanceMeters: number | null
  durationSeconds: number | null
}

/** Searches Google Places using only the server-owned key and a bounded field mask. */
export interface PlacesService {
  nearby(input: {
    category: PlaceCategory
    searchQuery: string | null
    radiusMeters: number
    travelMode: 'WALK' | 'DRIVE'
    location: Coordinates
  }): Promise<Place[]>
}

export class GooglePlacesService implements PlacesService {
  constructor(private readonly apiKey: string) {}

  private mapsUrl(uri: string | undefined, name: string, id: string): string {
    if (uri) {
      const url = new URL(uri)

      if (
        url.protocol === 'https:' &&
        ['www.google.com', 'maps.google.com'].includes(url.hostname)
      ) {
        return url.toString()
      }
    }

    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=${encodeURIComponent(id)}`
  }

  async nearby(input: {
    category: PlaceCategory
    searchQuery: string | null
    radiusMeters: number
    travelMode: 'WALK' | 'DRIVE'
    location: Coordinates
  }): Promise<Place[]> {
    const center = {
      latitude: input.location.latitude,
      longitude: input.location.longitude,
    }
    const textSearch = input.searchQuery !== null
    const url = textSearch
      ? 'https://places.googleapis.com/v1/places:searchText'
      : 'https://places.googleapis.com/v1/places:searchNearby'
    const search = textSearch
      ? {
          textQuery: input.searchQuery,
          pageSize: 5,
          locationBias: {
            circle: { center, radius: input.radiusMeters },
          },
        }
      : {
          includedTypes:
            input.category === 'cafe'
              ? ['cafe', 'coffee_shop']
              : [input.category],
          maxResultCount: 5,
          rankPreference: 'DISTANCE',
          locationRestriction: {
            circle: { center, radius: input.radiusMeters },
          },
        }
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.googleMapsUri,routingSummaries',
      },
      body: JSON.stringify({
        ...search,
        routingParameters: { origin: center, travelMode: input.travelMode },
      }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      throw new Error(`Google Places request failed (${response.status})`)
    }

    const parsed = googleResponse.parse(await response.json())
    return (parsed.places ?? []).map((place, index) => {
      const leg = parsed.routingSummaries?.[index]?.legs?.[0]
      const seconds = leg?.duration?.match(/^(\d+(?:\.\d+)?)s$/)

      return {
        name: place.displayName.text,
        address: place.formattedAddress ?? '',
        url: this.mapsUrl(
          place.googleMapsUri,
          place.displayName.text,
          place.id,
        ),
        distanceMeters: leg?.distanceMeters ?? null,
        durationSeconds: seconds ? Math.ceil(Number(seconds[1])) : null,
      }
    })
  }
}
