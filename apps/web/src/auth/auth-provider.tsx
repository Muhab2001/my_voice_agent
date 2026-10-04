import { authResponseSchema } from '@voice/contracts'
import {
  createContext,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from 'react'
import useSWR, { SWRConfig } from 'swr'
import { z } from 'zod'
import { ApiError, readJSON, usePublicApi } from '../hooks/api'

const AUTH_REFRESH_BUFFER_MS = 60_000
const createCache = () => new Map()
type AuthSession = z.output<typeof authResponseSchema>

export const AuthContext = createContext<{
  isAuthenticated: boolean
  isLoading: boolean
  error: Error | null
  login(password: string): Promise<void>
  logout(): Promise<void>
  getAccessToken(rejectedToken?: string): Promise<string>
} | null>(null)

/** SWR restores and renews the session; a separate cache scopes protected data. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const api = usePublicApi()
  const sessionRef = useRef<AuthSession | null>(null)
  const generation = useRef(0)
  const pendingRefresh = useRef<Promise<AuthSession> | null>(null)
  const [cacheVersion, setCacheVersion] = useState(0)
  const {
    data: session,
    error,
    isLoading,
    mutate,
  } = useSWR<AuthSession | null, Error>(
    '/v1/auth/refresh',
    async () => {
      const started = generation.current

      try {
        const next = await readJSON(
          await api({ path: '/v1/auth/refresh', method: 'POST' }),
          authResponseSchema,
        )

        if (started !== generation.current) {
          return sessionRef.current
        }

        sessionRef.current = next
        return next
      } catch (cause) {
        if (started !== generation.current) {
          return sessionRef.current
        }

        if (cause instanceof ApiError && cause.status === 401) {
          if (sessionRef.current) {
            generation.current += 1
            sessionRef.current = null
            setCacheVersion((version) => version + 1)
          }

          return null
        }

        throw cause
      }
    },
    {
      errorRetryInterval: 5_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      refreshInterval: (current) => {
        if (!current) {
          return 0
        }

        return Math.max(
          5_000,
          Date.parse(current.expiresAt) - Date.now() - AUTH_REFRESH_BUFFER_MS,
        )
      },
    },
  )

  const refreshSession = useCallback(async (): Promise<AuthSession> => {
    if (pendingRefresh.current) {
      return pendingRefresh.current
    }

    const refresh = mutate().then((next) => {
      if (!next) {
        throw new Error('Not authenticated')
      }

      return next
    })
    pendingRefresh.current = refresh

    try {
      return await refresh
    } finally {
      pendingRefresh.current = null
    }
  }, [mutate])

  const getAccessToken = useCallback(
    async (rejectedToken?: string): Promise<string> => {
      const current = sessionRef.current

      if (!current) {
        throw new Error('Not authenticated')
      }

      if (
        current.accessToken !== rejectedToken &&
        Date.parse(current.expiresAt) - Date.now() > AUTH_REFRESH_BUFFER_MS
      ) {
        return current.accessToken
      }

      return (await refreshSession()).accessToken
    },
    [refreshSession],
  )

  const login = useCallback(
    async (password: string): Promise<void> => {
      const next = await readJSON(
        await api({
          path: '/v1/auth/login',
          method: 'POST',
          body: { password },
        }),
        authResponseSchema,
      )

      generation.current += 1
      sessionRef.current = next
      await mutate(next, { revalidate: false })
      setCacheVersion((version) => version + 1)
    },
    [api, mutate],
  )

  const logout = useCallback(async (): Promise<void> => {
    await readJSON(
      await api({ path: '/v1/auth/logout', method: 'POST' }),
      z.undefined(),
    )

    generation.current += 1
    sessionRef.current = null
    await mutate(null, { revalidate: false })
    setCacheVersion((version) => version + 1)
  }, [api, mutate])

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: Boolean(session),
        isLoading,
        error: error ?? null,
        login,
        logout,
        getAccessToken,
      }}
    >
      <SWRConfig value={{ provider: createCache }} key={cacheVersion}>
        {children}
      </SWRConfig>
    </AuthContext.Provider>
  )
}
