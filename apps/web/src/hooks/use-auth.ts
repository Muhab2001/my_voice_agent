import { useCallback } from 'react'
import useSWR from 'swr'
import {
  AUTH_REFRESH_BUFFER_MS,
  type AuthSession,
  apiClient,
} from '../lib/api-client'

const sessionKey = 'auth/session'

export function useAuth() {
  const { data, error, isLoading, mutate } = useSWR<AuthSession | null>(
    sessionKey,
    async () => {
      try {
        return await apiClient.refresh()
      } catch {
        apiClient.clearAccessToken()
        return null
      }
    },
    {
      revalidateOnFocus: false,
      refreshInterval: (session) => {
        if (!session) return 0
        return Math.max(
          5_000,
          new Date(session.expiresAt).getTime() -
            Date.now() -
            AUTH_REFRESH_BUFFER_MS,
        )
      },
    },
  )

  const login = useCallback(
    async (password: string) => {
      const session = await apiClient.login({ password })
      await mutate(session, { revalidate: false })
    },
    [mutate],
  )

  const logout = useCallback(async () => {
    apiClient.clearAccessToken()
    await mutate(null, { revalidate: false })
    await apiClient.logout()
  }, [mutate])

  return {
    isAuthenticated: Boolean(data),
    isLoading,
    error,
    login,
    logout,
  }
}
