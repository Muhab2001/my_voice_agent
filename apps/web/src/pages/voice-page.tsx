import { LogOut, Mic, MicOff, Play, Square } from 'lucide-react'
import { useState } from 'react'
import { Brand } from '../components/brand'
import { LiveCaptions } from '../components/live-captions'
import { Button } from '../components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../components/ui/tooltip'
import { VoiceOrb } from '../components/voice-orb'
import { useAuth } from '../hooks/use-auth'
import { useVoiceSession } from '../hooks/use-voice-session'

export function VoicePage() {
  const { logout } = useAuth()
  const voice = useVoiceSession()
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const active = voice.status === 'connected' || voice.status === 'connecting'
  const hasStarted = active || voice.status === 'stopping'
  const sessionAction = active
    ? 'Stop session'
    : voice.status === 'stopping'
      ? 'Stopping session'
      : 'Start session'

  async function signOut() {
    await voice.stop()
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
      <div className="flex min-h-svh flex-col overflow-hidden bg-[#f7f8fb]">
        <header className="mx-auto flex w-full max-w-[1190px] items-center justify-between px-6 py-7 sm:px-9">
          <Brand />
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
              <LiveCaptions items={voice.transcript} />
            </div>
            <VoiceOrb
              status={voice.status}
              muted={voice.muted}
              audioPlaying={voice.audioPlaying}
              audioReady={voice.audioReady}
              inputLevel={voice.inputLevel}
              onReplay={voice.replayAudio}
            />
            <div className="mt-8 flex items-center gap-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    type="button"
                    variant="ghost"
                    onClick={active ? voice.stop : voice.start}
                    disabled={voice.status === 'stopping'}
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
                    onClick={voice.toggleMute}
                    disabled={voice.status !== 'connected'}
                    aria-label={
                      voice.muted ? 'Unmute microphone' : 'Mute microphone'
                    }
                    aria-pressed={voice.muted}
                    className={`size-13 rounded-full border-0 bg-transparent p-0 shadow-none transition-colors duration-200 hover:bg-transparent hover:text-[#c44858] disabled:opacity-100 ${voice.muted ? 'text-[#c44858]' : 'text-[#77859a]'}`}
                  >
                    {voice.muted ? (
                      <MicOff className="size-5" />
                    ) : (
                      <Mic className="size-5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {voice.muted ? 'Unmute' : 'Mute'}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
          {(voice.error || logoutError) && (
            <p
              className="mt-7 max-w-sm text-center text-sm text-destructive"
              role="alert"
            >
              {voice.error || logoutError}
            </p>
          )}
        </main>
      </div>
    </TooltipProvider>
  )
}
