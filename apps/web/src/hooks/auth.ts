import { useContext } from 'react'
import { AuthContext } from '../auth/auth-provider'

/** Reads the provider-owned session status and stable authentication actions. */
export function useAuth() {
  const auth = useContext(AuthContext)

  if (!auth) {
    throw new Error('useAuth must be used within AuthProvider')
  }

  return auth
}
