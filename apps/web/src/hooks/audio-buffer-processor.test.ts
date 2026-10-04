import { expect, test } from 'bun:test'

type Processor = {
  port: { onmessage: (event: { data: unknown }) => void }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean
}

test('startup audio stays silent until activation, then plays in order and catches up', async () => {
  const names = [
    'sampleRate',
    'AudioWorkletProcessor',
    'registerProcessor',
  ] as const
  const previous = names.map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  )
  let ProcessorType!: new () => Processor

  Object.assign(globalThis, {
    sampleRate: 100,
    AudioWorkletProcessor: class {
      port = { onmessage: (_event: { data: unknown }) => {} }
    },
    registerProcessor: (name: string, type: new () => Processor) => {
      expect(name).toBe('startup-audio-buffer')
      ProcessorType = type
    },
  })

  try {
    await import('./audio-buffer-processor')
    const processor = new ProcessorType()
    const frame = (level: number) => {
      const output = new Float32Array(10)
      expect(
        processor.process([[new Float32Array(10).fill(level)]], [[output]]),
      ).toBe(true)
      return Number(output[0].toFixed(2))
    }

    for (let index = 0; index < 6; index += 1) {
      expect(frame(0)).toBe(0)
    }

    expect(frame(0.1)).toBe(0)
    expect(frame(0.2)).toBe(0)

    for (let index = 0; index < 6; index += 1) {
      expect(frame(0)).toBe(0)
    }

    processor.port.onmessage({ data: { type: 'activate' } })
    const played = [frame(0.3), ...Array.from({ length: 16 }, () => frame(0))]
    expect(played.filter((level) => level > 0)).toEqual([0.1, 0.2, 0.3])
    expect(frame(0.4)).toBe(0.4)

    processor.port.onmessage({ data: { type: 'mute', muted: true } })
    expect(frame(0.5)).toBe(0)
    processor.port.onmessage({ data: { type: 'mute', muted: false } })
    expect(frame(0.6)).toBe(0.6)
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor)
      } else {
        Reflect.deleteProperty(globalThis, name)
      }
    }
  }
})
