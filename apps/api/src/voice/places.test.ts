import { expect, spyOn, test } from 'bun:test'
import { GooglePlacesService } from './places.js'

test('Google Places uses typed nearby search and text search for other places', async () => {
  const requests: { url: string; body: Record<string, unknown> }[] = []
  const mockFetch = async (
    url: Parameters<typeof fetch>[0],
    options?: Parameters<typeof fetch>[1],
  ) => {
    requests.push({
      url: String(url),
      body: JSON.parse(String(options?.body)) as Record<string, unknown>,
    })

    return new Response(JSON.stringify({ places: [] }), { status: 200 })
  }
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(
    mockFetch as typeof fetch,
  )
  const places = new GooglePlacesService('test-key')
  const location = { latitude: 24.7, longitude: 46.7, accuracyMeters: 20 }

  try {
    for (const category of ['cafe', 'restaurant', 'hotel', 'park'] as const) {
      await places.nearby({
        category,
        searchQuery: null,
        radiusMeters: 15000,
        travelMode: 'DRIVE',
        location,
      })
    }

    await places.nearby({
      category: 'other',
      searchQuery: 'museums',
      radiusMeters: 15000,
      travelMode: 'DRIVE',
      location,
    })

    expect(requests.map((request) => request.url)).toEqual([
      ...Array(4).fill('https://places.googleapis.com/v1/places:searchNearby'),
      'https://places.googleapis.com/v1/places:searchText',
    ])
    expect(requests[0]?.body.includedTypes).toEqual(['cafe', 'coffee_shop'])
    expect(requests[2]?.body.includedTypes).toEqual(['hotel'])
    expect(requests[3]?.body.includedTypes).toEqual(['park'])
    expect(requests[3]?.body.locationRestriction).toEqual({
      circle: {
        center: { latitude: 24.7, longitude: 46.7 },
        radius: 15000,
      },
    })
    expect(requests[4]?.body).toMatchObject({
      textQuery: 'museums',
      pageSize: 5,
      locationBias: {
        circle: {
          center: { latitude: 24.7, longitude: 46.7 },
          radius: 15000,
        },
      },
    })
  } finally {
    fetchMock.mockRestore()
  }
})
