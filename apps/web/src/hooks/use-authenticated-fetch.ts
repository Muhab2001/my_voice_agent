import { useCallback } from 'react'
import { type AuthenticatedRequestInput, fetchAuthenticated } from '../lib/http'
import { useAuth } from './use-auth'

/** Adds the provider's current token to HTTP calls without storing request state. */
export function useAuthenticatedFetch() {
  const { getAccessToken } = useAuth()

  return useCallback(
    (input: AuthenticatedRequestInput) =>
      fetchAuthenticated(input, getAccessToken),
    [getAccessToken],
  )
}
