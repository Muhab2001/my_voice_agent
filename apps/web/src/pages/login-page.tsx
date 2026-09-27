import { ArrowRight, Eye, EyeOff, LockKeyhole } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Brand } from '../components/brand'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { useAuth } from '../hooks/use-auth'

export function LoginPage() {
  const { isAuthenticated, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (isAuthenticated) return <Navigate to="/" replace />

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!password || pending) return
    setPending(true)
    setError(null)
    try {
      await login(password)
      navigate((location.state as { from?: string } | null)?.from ?? '/', {
        replace: true,
      })
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message !== 'Invalid credentials'
          ? cause.message
          : 'Incorrect password. Please try again.',
      )
      setPassword('')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="relative grid min-h-svh place-items-center overflow-hidden bg-[#f7f8fb]">
      <div
        className="pointer-events-none absolute -bottom-40 -left-40 size-[580px] rounded-full bg-[#e9effc] blur-[100px]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -top-56 right-0 size-[520px] rounded-full bg-[#eef1fb] blur-[100px]"
        aria-hidden="true"
      />
      <div className="relative w-full max-w-[440px] px-6 py-12 sm:px-4">
        <div className="mb-7">
          <Brand />
        </div>
        <h1 className="ml-[-4px] text-left text-[clamp(2.35rem,5vw,3rem)] leading-[1.12] font-medium tracking-[-0.05em] text-[#202a38]">
          Welcome Back!
        </h1>
        <p className="mt-2 text-left text-[15px] leading-6 text-[#6e7b90]">
          Sign in to get talking.
        </p>
        <form className="mt-7" onSubmit={submit}>
          <Label
            htmlFor="password"
            className="mb-2.5 text-[13px] font-medium text-[#3e4b5f]"
          >
            Password
          </Label>
          <div className="flex h-[50px] items-center rounded-md border border-[#d7deea] bg-transparent px-3 focus-within:border-primary/70 focus-within:ring-3 focus-within:ring-primary/20">
            <LockKeyhole
              className="size-[18px] shrink-0 text-[#8a97aa]"
              aria-hidden="true"
            />
            <Input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              required
              maxLength={1024}
              aria-describedby={error ? 'login-error' : undefined}
              className="h-full flex-1 rounded-none border-0 bg-transparent px-3 text-sm shadow-none placeholder:text-[#9ba6b6] focus-visible:border-0 focus-visible:ring-0"
            />
            <Button
              variant="ghost"
              size="icon"
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              className="size-8 shrink-0 rounded-md text-[#78869b] hover:bg-transparent hover:text-primary"
            >
              {showPassword ? (
                <EyeOff className="size-[18px]" />
              ) : (
                <Eye className="size-[18px]" />
              )}
            </Button>
          </div>
          <div
            className="min-h-8 pt-2 text-xs text-destructive"
            id="login-error"
            role="alert"
          >
            {error}
          </div>
          <Button
            className="h-[50px] w-full justify-between rounded-md bg-primary px-5 text-sm font-medium shadow-none hover:bg-[#263e9b]"
            disabled={pending || !password}
            type="submit"
          >
            {pending ? 'Signing in…' : 'Continue'}
            {!pending && <ArrowRight className="size-[18px]" />}
          </Button>
        </form>
      </div>
    </main>
  )
}
