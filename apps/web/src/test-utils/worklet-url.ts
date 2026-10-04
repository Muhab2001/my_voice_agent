import { mock } from 'bun:test'

mock.module('../hooks/audio-buffer-processor.ts?worker&url', () => ({
  default: '/audio-buffer-processor.js',
}))
