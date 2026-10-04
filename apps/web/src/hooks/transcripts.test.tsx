import { expect, mock, test } from 'bun:test'
import { act } from '@testing-library/react/pure'
import { renderAuthenticatedHook } from '../test-utils/render-hook'
import type { SessionConnection } from './session-manager'
import { useTranscripts } from './transcripts'

function connectionFixture() {
  const controller = new AbortController()
  const channel = Object.assign(new EventTarget(), { close: mock(() => {}) })
  const peer = { close: mock(() => {}) }
  const connection: SessionConnection = {
    channel: channel as unknown as RTCDataChannel,
    peer: peer as unknown as RTCPeerConnection,
    signal: controller.signal,
  }

  return {
    ...connection,
    controller,
    closeChannel: channel.close,
    closePeer: peer.close,
  }
}

function send(connection: SessionConnection, type: string, delta?: string) {
  connection.channel.dispatchEvent(
    new MessageEvent('message', { data: JSON.stringify({ type, delta }) }),
  )
}

test('transcripts accumulate exact caption text and change identity when the speaker changes', async () => {
  const app = await renderAuthenticatedHook(useTranscripts, undefined)
  const connection = connectionFixture()

  try {
    await act(async () => {
      app.result.current.start(connection)
      send(connection, 'session.input_transcript.delta', 'Hello ')
      send(connection, 'session.input_transcript.delta', 'there')
    })

    expect(app.result.current.items[0]?.text).toBe('Hello there')
    const userCaption = app.result.current.items[0]?.id

    await act(async () => {
      send(connection, 'session.output_transcript.delta', 'Welcome')
    })

    expect(app.result.current.items[0]?.text).toBe('Welcome')
    expect(app.result.current.items[0]?.id).not.toBe(userCaption)

    await act(async () => {
      send(connection, 'session.input_transcript.delta', 'New turn')
    })

    expect(app.result.current.items[0]?.text).toBe('New turn')
    expect(app.result.current.items[0]?.id).not.toBe(userCaption)
  } finally {
    await app.cleanup()
  }
})

test('transcripts ignore lifecycle and malformed messages, and cap displayed text at 500 characters', async () => {
  const app = await renderAuthenticatedHook(useTranscripts, undefined)
  const connection = connectionFixture()

  try {
    await act(async () => {
      app.result.current.start(connection)
      send(connection, 'session.started')
      send(connection, 'session.closed')
      send(connection, 'error')
      connection.channel.dispatchEvent(
        new MessageEvent('message', { data: '{broken' }),
      )
      send(connection, 'session.input_transcript.delta')
    })

    expect(app.result.current.items).toEqual([])

    await act(async () => {
      send(
        connection,
        'session.output_transcript.delta',
        `${'a'.repeat(600)} end`,
      )
    })

    expect(app.result.current.items[0]?.text).toHaveLength(500)
    expect(app.result.current.items[0]?.text.endsWith(' end')).toBe(true)
  } finally {
    await app.cleanup()
  }
})

test('switching or ending the transcript connection detaches the previous listener', async () => {
  const app = await renderAuthenticatedHook(useTranscripts, undefined)
  const oldConnection = connectionFixture()
  const nextConnection = connectionFixture()

  try {
    await act(async () => {
      app.result.current.start(oldConnection)
      send(oldConnection, 'session.input_transcript.delta', 'Old')
      app.result.current.start(nextConnection)
      send(oldConnection, 'session.input_transcript.delta', ' stale')
    })

    expect(app.result.current.items).toEqual([])

    await act(async () => {
      send(nextConnection, 'session.output_transcript.delta', 'Current')
    })

    expect(app.result.current.items[0]?.text).toBe('Current')

    await act(async () => {
      oldConnection.controller.abort()
    })

    expect(app.result.current.items[0]?.text).toBe('Current')

    await act(async () => {
      app.result.current.end()
      send(nextConnection, 'session.output_transcript.delta', ' stale')
    })

    expect(app.result.current.items).toEqual([])
  } finally {
    await app.cleanup()
  }
})

test('session shutdown clears captions and ignores late messages without closing shared resources', async () => {
  const app = await renderAuthenticatedHook(useTranscripts, undefined)
  const connection = connectionFixture()

  try {
    await act(async () => {
      app.result.current.start(connection)
      send(connection, 'session.input_transcript.delta', 'Before shutdown')
    })

    expect(app.result.current.items[0]?.text).toBe('Before shutdown')

    await act(async () => {
      connection.controller.abort()
      send(connection, 'session.input_transcript.delta', ' late')
    })

    expect(app.result.current.items).toEqual([])
    expect(connection.closeChannel).not.toHaveBeenCalled()
    expect(connection.closePeer).not.toHaveBeenCalled()
  } finally {
    await app.cleanup()
  }
})

test('an already ended session cannot attach transcripts or leave earlier captions visible', async () => {
  const app = await renderAuthenticatedHook(useTranscripts, undefined)
  const oldConnection = connectionFixture()
  const endedConnection = connectionFixture()
  endedConnection.controller.abort()

  try {
    await act(async () => {
      app.result.current.start(oldConnection)
      send(oldConnection, 'session.input_transcript.delta', 'Old captions')
      app.result.current.start(endedConnection)
      send(endedConnection, 'session.input_transcript.delta', 'Ended captions')
      send(oldConnection, 'session.input_transcript.delta', ' late')
    })

    expect(app.result.current.items).toEqual([])
    expect(endedConnection.closeChannel).not.toHaveBeenCalled()
    expect(endedConnection.closePeer).not.toHaveBeenCalled()
  } finally {
    await app.cleanup()
  }
})
