import { expect, test } from 'bun:test'
import { render } from '@testing-library/react/pure'
import { renderAuthenticatedHook } from '../test-utils/render-hook'
import { VoiceOrb } from './voice-orb'

test('orb responds to microphone input while the session is connecting', async () => {
  const browser = await renderAuthenticatedHook(() => null, undefined)

  try {
    const props = {
      connected: false,
      listening: true,
      muted: false,
      audioPlaying: false,
      audioReady: false,
      inputLevel: 0.5,
      onReplay: () => {},
    }
    const view = render(<VoiceOrb {...props} />)
    const orb = view.container.querySelector('[data-orb-state]')
    expect(orb?.getAttribute('data-orb-state')).toBe('speaking')

    view.rerender(<VoiceOrb {...props} listening={false} />)
    expect(orb?.getAttribute('data-orb-state')).toBe('resting')

    view.rerender(<VoiceOrb {...props} connected audioPlaying />)
    expect(orb?.getAttribute('data-orb-state')).toBe('speaking')
  } finally {
    await browser.cleanup()
  }
})
