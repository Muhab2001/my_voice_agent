import { LogOut, Mic, MicOff, Play, Square } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Brand } from '../components/brand'
import { FloatingCards } from '../components/floating-cards'
import { LiveCaptions } from '../components/live-captions'
import { LocationControl } from '../components/location-control'
import { Button } from '../components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../components/ui/tooltip'
import { VoiceOrb } from '../components/voice-orb'
import { useAudioManager } from '../hooks/use-audio-manager'
import { useAuth } from '../hooks/use-auth'
import { useFloatingCards } from '../hooks/use-floating-cards'
import { useLocationTracking } from '../hooks/use-location-tracking'
import type { SessionConnection } from '../hooks/use-session-manager'
import { useSessionManager } from '../hooks/use-session-manager'
import { useTranscripts } from '../hooks/use-transcripts'
import { useUIEventStream } from '../hooks/use-ui-event-stream'

export function VoicePage() {
  const { logout } = useAuth()
  const location = useLocationTracking()
  const cards = useFloatingCards()
  const session = useSessionManager()
  const audio = useAudioManager()
  const transcripts = useTranscripts()
  const ui = useUIEventStream(cards.receive)
  const [startError, setStartError] = useState<string | null>(null)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const active =
    session.status === 'connected' || session.status === 'connecting'
  const hasStarted = active || session.status === 'stopping'
  const sessionAction = active
    ? 'Stop session'
    : session.status === 'stopping'
      ? 'Stopping session'
      : 'Start session'
  const error =
    startError || session.error || audio.error || ui.error || logoutError

  const stopSession = useCallback(async () => {
    ui.end()
    await session.end()
  }, [ui.end, session.end])

  useEffect(() => {
    if (session.status === 'ended' || session.status === 'failed') {
      void stopSession()
    }
  }, [session.status, stopSession])

  async function startSession() {
    let connection: SessionConnection | null = null

    try {
      connection = session.prepare()

      if (!connection) {
        return
      }

      setStartError(null)
      cards.clear()
      transcripts.start(connection)
      await audio.start(connection)

      if (connection.signal.aborted) {
        return
      }

      const created = await session.start()

      if (!created || connection.signal.aborted) {
        return
      }

      await ui.start(created.id)
    } catch (cause) {
      if (!connection?.signal.aborted) {
        setStartError(
          cause instanceof Error
            ? cause.message
            : 'Could not start the session.',
        )
        await stopSession()
      }
    }
  }

  async function signOut() {
    await stopSession()
    try {
      await logout()
    } catch {
      setLogoutError(
        'Could not clear the server cookie. Please try again when the server is available.',
      )
    }
  }

  return (
    <TooltipProvider skipDelayDuration={0}>
      <div className="flex min-h-svh flex-col bg-[#f7f8fb]">
        <header className="mx-auto flex w-full max-w-[1190px] items-center justify-between px-6 py-7 sm:px-9">
          <Brand />
          <div className="flex items-center gap-2">
            <LocationControl location={location} />
            <Tooltip delayDuration={3000}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  onClick={signOut}
                  aria-label="Sign out"
                  className="size-10 rounded-full bg-transparent text-[#68758a] shadow-none transition-colors duration-300 ease-in-out hover:bg-white hover:text-[#c44858]"
                >
                  <LogOut className="size-[18px]" />
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                className="border border-[#e1e6ef] bg-white text-[#4b586e] shadow-sm [&_svg]:bg-white [&_svg]:fill-white"
              >
                Sign out
              </TooltipContent>
            </Tooltip>
          </div>
        </header>
        <main className="flex flex-1 flex-col items-center justify-center px-5 pb-16">
          <h1 className="sr-only">Voice session</h1>
          <div className="relative flex flex-col items-center">
            <div className="pointer-events-none absolute bottom-full mb-5 flex min-h-18 w-[min(90vw,640px)] items-end justify-center text-center sm:mb-7">
              <p
                className={`absolute bottom-0 w-max text-[22px] font-medium tracking-[-0.035em] text-[#344155] transition-all duration-500 sm:text-[26px] ${hasStarted ? '-translate-y-2 opacity-0' : 'translate-y-0 opacity-100'}`}
                aria-hidden={hasStarted}
              >
                Ready when you are
              </p>
              <LiveCaptions items={transcripts.items} />
            </div>
            <VoiceOrb
              connected={session.status === 'connected'}
              muted={audio.muted}
              audioPlaying={audio.audioPlaying}
              audioReady={audio.audioReady}
              inputLevel={audio.inputLevel}
              onReplay={audio.replayAudio}
            />
            <div className="mt-8 flex items-center gap-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    type="button"
                    variant="ghost"
                    onClick={active ? stopSession : startSession}
                    disabled={
                      session.status === 'stopping' ||
                      !location.data ||
                      Boolean(location.error)
                    }
                    aria-label={sessionAction}
                    className={`size-13 rounded-full border-0 bg-transparent p-0 shadow-none transition-colors duration-200 hover:bg-[#edf2ff] hover:text-primary ${active ? 'text-primary' : 'text-[#77859a]'}`}
                  >
                    {active ? (
                      <Square className="size-5 fill-current" />
                    ) : (
                      <Play className="size-5 fill-current" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{sessionAction}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    onClick={audio.toggleMute}
                    disabled={session.status !== 'connected'}
                    aria-label={
                      audio.muted ? 'Unmute microphone' : 'Mute microphone'
                    }
                    aria-pressed={audio.muted}
                    className={`size-13 rounded-full border-0 bg-transparent p-0 shadow-none transition-colors duration-200 hover:bg-transparent hover:text-[#c44858] disabled:opacity-100 ${audio.muted ? 'text-[#c44858]' : 'text-[#77859a]'}`}
                  >
                    {audio.muted ? (
                      <MicOff className="size-5" />
                    ) : (
                      <Mic className="size-5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {audio.muted ? 'Unmute' : 'Mute'}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
          {error && (
            <p
              className="mt-7 max-w-sm text-center text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}
        </main>
        <FloatingCards cards={cards.cards} onDismiss={cards.dismiss} />
      </div>
    </TooltipProvider>
  )
}
