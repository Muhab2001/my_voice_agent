import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthGate } from '../components/auth-gate'
import { LoginPage } from '../pages/login-page'
import { VoicePage } from '../pages/voice-page'

export function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<AuthGate />}>
          <Route path="/" element={<VoicePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
