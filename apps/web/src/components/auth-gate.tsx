import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/use-auth'

export function AuthGate() {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()
  if (isLoading) {
    return (
      <main
        className="flex min-h-svh items-center justify-center gap-3 text-sm text-muted-foreground"
        role="status"
      >
        <span className="size-5 animate-spin rounded-full border-2 border-[#dce3f3] border-t-primary" />
        Restoring session…
      </main>
    )
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }
  return <Outlet />
}
