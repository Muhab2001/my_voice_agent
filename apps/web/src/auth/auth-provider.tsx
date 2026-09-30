import { authResponseSchema } from '@voice/contracts'
import {
  createContext,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from 'react'
import { SWRConfig } from 'swr'
import type { z } from 'zod'
import { ApiError, assertOk, fetchApi, parseJson } from '../lib/http'

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

/** Owns authentication in React state and scopes protected SWR data to a session. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [cacheVersion, setCacheVersion] = useState(0)

  const refreshSession = useCallback(async (): Promise<AuthSession> => {
    try {
      const next = await parseJson(
        await fetchApi({ path: '/v1/auth/refresh', method: 'POST' }),
        authResponseSchema,
      )

      setSession(next)
      setError(null)
      return next
    } catch (cause) {
      setError(
        new Error(
          cause instanceof Error ? cause.message : 'Could not refresh session',
          { cause },
        ),
      )

      if (cause instanceof ApiError && cause.status === 401) {
        setSession(null)
        setCacheVersion((version) => version + 1)
      }

      throw cause
    }
  }, [])

  const getAccessToken = useCallback(
    async (rejectedToken?: string): Promise<string> => {
      if (!session) {
        throw new Error('Not authenticated')
      }

      if (
        session.accessToken !== rejectedToken &&
        Date.parse(session.expiresAt) - Date.now() > AUTH_REFRESH_BUFFER_MS
      ) {
        return session.accessToken
      }

      return (await refreshSession()).accessToken
    },
    [session, refreshSession],
  )

  const login = useCallback(async (password: string): Promise<void> => {
    const next = await parseJson(
      await fetchApi({
        path: '/v1/auth/login',
        method: 'POST',
        body: { password },
      }),
      authResponseSchema,
    )

    setSession(next)
    setError(null)
    setCacheVersion((version) => version + 1)
  }, [])

  const logout = useCallback(async (): Promise<void> => {
    await assertOk(await fetchApi({ path: '/v1/auth/logout', method: 'POST' }))

    setSession(null)
    setError(null)
    setCacheVersion((version) => version + 1)
  }, [])

  useEffect(() => {
    void refreshSession()
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [refreshSession])

  useEffect(() => {
    if (!session) {
      return
    }

    const refreshIfNeeded = () => {
      void getAccessToken().catch(() => {})
    }
    const delay = error
      ? 5_000
      : Math.max(
          5_000,
          Date.parse(session.expiresAt) - Date.now() - AUTH_REFRESH_BUFFER_MS,
        )
    const timer = window.setTimeout(() => {
      void getAccessToken(session.accessToken).catch(() => {})
    }, delay)
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshIfNeeded()
      }
    }

    window.addEventListener('online', refreshIfNeeded)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('online', refreshIfNeeded)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [session, error, getAccessToken])

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: Boolean(session),
        isLoading,
        error,
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
