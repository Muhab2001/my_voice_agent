import { useEffect, useState } from 'react'

const barNames = ['far-left', 'near-left', 'center', 'near-right', 'far-right']
const barFrames = [
  [20, 40, 60, 40, 20],
  [34, 52, 36, 48, 28],
  [24, 30, 58, 26, 42],
  [40, 48, 32, 54, 22],
  [18, 36, 52, 36, 32],
]

type Props = {
  connected: boolean
  muted: boolean
  audioPlaying: boolean
  audioReady: boolean
  inputLevel: number
  onReplay: () => void
}

export function VoiceOrb({
  connected,
  muted,
  audioPlaying,
  audioReady,
  inputLevel,
  onReplay,
}: Props) {
  const speakingStrength =
    connected && !muted
      ? Math.min(1, Math.max(0, (inputLevel - 0.02) * 3.2))
      : 0
  const [speakingVisible, setSpeakingVisible] = useState(false)
  const [barFrame, setBarFrame] = useState(0)

  useEffect(() => {
    if (!connected || muted || audioPlaying) {
      setSpeakingVisible(false)
      return
    }
    if (speakingStrength > 0.1) {
      setSpeakingVisible(true)
      return
    }
    const timer = window.setTimeout(() => setSpeakingVisible(false), 350)
    return () => window.clearTimeout(timer)
  }, [connected, muted, audioPlaying, speakingStrength])

  useEffect(() => {
    if (!audioPlaying && !speakingVisible) {
      setBarFrame(0)
      return
    }
    setBarFrame(1)
    const timer = window.setInterval(() => {
      setBarFrame((frame) => (frame + 1) % barFrames.length)
    }, 180)
    return () => window.clearInterval(timer)
  }, [audioPlaying, speakingVisible])

  const speakingOpacity = audioPlaying || !speakingVisible ? 0 : 1
  const receivingOpacity = audioPlaying ? 1 : 0
  const tint = audioPlaying
    ? 'receiving'
    : speakingVisible
      ? 'speaking'
      : 'resting'
  const scale = audioPlaying ? 1.035 : 1 + speakingStrength * 0.055
  const motionStrength = audioPlaying
    ? 1
    : speakingVisible
      ? Math.max(0.45, speakingStrength)
      : 0

  return (
    <div
      className="relative grid size-[270px] place-items-center sm:size-[340px]"
      data-orb-state={tint}
    >
      <span
        className="absolute inset-1 rounded-full border border-[#dce5f7] bg-[#f1f5fe]/60"
        aria-hidden="true"
      />
      <span
        className="absolute inset-1 rounded-full border border-[#e9b7d0] bg-[#fdf0f6]/70 opacity-0 transition-opacity duration-700 ease-out"
        style={{ opacity: speakingOpacity }}
        aria-hidden="true"
      />
      <span
        className="absolute inset-1 rounded-full border border-[#c0c4ec] bg-[#f2f1ff]/65 opacity-0 transition-opacity duration-700 ease-out"
        style={{ opacity: receivingOpacity }}
        aria-hidden="true"
      />
      <span
        className="absolute inset-9 rounded-full bg-[#a8bae8]/25 blur-2xl"
        aria-hidden="true"
      />
      <span
        className="absolute inset-9 rounded-full bg-[#e8a4c4]/40 opacity-0 blur-2xl transition-opacity duration-700 ease-out"
        style={{ opacity: speakingOpacity }}
        aria-hidden="true"
      />
      <span
        className="absolute inset-9 rounded-full bg-[#a5a3e3]/40 opacity-0 blur-2xl transition-opacity duration-700 ease-out"
        style={{ opacity: receivingOpacity }}
        aria-hidden="true"
      />
      <button
        type="button"
        disabled={!connected || !audioReady || audioPlaying}
        onClick={onReplay}
        aria-label="Enable assistant audio"
        title={connected && audioReady ? 'Enable assistant audio' : undefined}
        className="relative grid size-[205px] cursor-pointer place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#6681d2] to-[#a4b5e9] text-white shadow-[0_18px_45px_#4566bd25] transition-transform duration-500 ease-out focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:cursor-default sm:size-[255px]"
        style={{ transform: `scale(${scale})` }}
      >
        <span
          className="absolute inset-0 rounded-full bg-gradient-to-br from-[#c96f9b] to-[#e8a8c2] opacity-0 transition-opacity duration-700 ease-out"
          style={{ opacity: speakingOpacity }}
          aria-hidden="true"
        />
        <span
          className="absolute inset-0 rounded-full bg-gradient-to-br from-[#878ed7] to-[#bdc1f0] opacity-0 transition-opacity duration-700 ease-out"
          style={{ opacity: receivingOpacity }}
          aria-hidden="true"
        />
        <span
          className="relative flex items-center gap-[7px]"
          aria-hidden="true"
        >
          {barNames.map((name, index) => (
            <i
              key={name}
              className="w-[5px] rounded-full bg-white/90 transition-[height] duration-200 ease-in-out"
              style={{
                height: `${Math.round(barFrames[0][index] + (barFrames[barFrame][index] - barFrames[0][index]) * motionStrength)}px`,
              }}
            />
          ))}
        </span>
      </button>
    </div>
  )
}
