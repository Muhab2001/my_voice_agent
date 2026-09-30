import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { useAuthenticatedFetch } from './use-authenticated-fetch'

function browserPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is unavailable'))
      return
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 0,
    })
  })
}

/** Saves a fresh position on demand, then every ten minutes while mounted. */
export function useLocationTracking() {
  const send = useAuthenticatedFetch()

  const [permission, setPermission] = useState<PermissionState | 'checking'>(
    'checking',
  )
  const location = useSWR(
    '/v1/location',
    async () => {
      const { coords } = await browserPosition()
      const location = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracyMeters: coords.accuracy,
      }
      await send({ path: '/v1/location', method: 'POST', body: location })
      return location
    },
    {
      revalidateOnMount: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      refreshInterval: (location) => (location ? 10 * 60_000 : 0),
      shouldRetryOnError: false,
    },
  )

  const { mutate } = location

  useEffect(() => {
    let canceled = false

    if (!navigator.permissions?.query) {
      setPermission('prompt')
      return
    }

    void navigator.permissions
      .query({ name: 'geolocation' })
      .then((result) => {
        if (canceled) {
          return
        }

        setPermission(result.state)

        if (result.state === 'granted') {
          void mutate().catch(() => {})
        }
      })
      .catch(() => {
        if (!canceled) {
          setPermission('prompt')
        }
      })

    return () => {
      canceled = true
    }
  }, [mutate])

  return { ...location, permission }
}
