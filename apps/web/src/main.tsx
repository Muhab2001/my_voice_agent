import { createRoot } from 'react-dom/client'
import { SWRConfig } from 'swr'
import { AppRoutes } from './app/routes'
import { AuthProvider } from './auth/auth-provider'
import './themes/global.css'

const root = document.getElementById('root')
if (!root) {
  throw new Error('Root element is missing')
}

createRoot(root).render(
  <SWRConfig value={{ shouldRetryOnError: false }}>
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  </SWRConfig>,
)
