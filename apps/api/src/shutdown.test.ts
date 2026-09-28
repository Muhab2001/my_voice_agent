import { expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { connect, createServer } from 'node:net'

test('SIGTERM drains an in-flight request and exits promptly', async () => {
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const address = reservation.address()
  if (!address || typeof address === 'string') {
    throw new Error('No port')
  }
  const port = address.port
  reservation.close()
  await once(reservation, 'close')

  const child = spawn(process.execPath, ['src/testing/shutdown-fixture.ts'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  // Register before shutdown; the process can exit before the socket finishes reading.
  const exited = once(child, 'exit')

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += String(chunk)
  })
  child.stderr.on('data', (chunk) => {
    output += String(chunk)
  })
  const deadline = setTimeout(() => child.kill('SIGKILL'), 8_000)
  try {
    while (!output.includes('API listening')) {
      if (child.exitCode !== null) {
        throw new Error(`API exited: ${output}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const socket = connect(port, '127.0.0.1')
    await once(socket, 'connect')
    const body = JSON.stringify({ password: 'correct-password' })
    const halfway = Math.floor(body.length / 2)
    socket.write(
      `POST /v1/auth/login HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body.slice(0, halfway)}`,
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    child.kill('SIGTERM')
    socket.write(body.slice(halfway))
    let response = ''
    socket.on('data', (chunk) => {
      response += String(chunk)
    })
    await once(socket, 'end')
    expect(response).toContain('200 OK')
    const [code, signal] = (await exited) as [
      number | null,
      NodeJS.Signals | null,
    ]
    expect(code).toBe(0)
    expect(signal).toBeNull()
  } finally {
    clearTimeout(deadline)
    if (child.exitCode === null) {
      child.kill('SIGKILL')
    }
  }
}, 10_000)

test('SIGTERM completes pending memory, transcripts and provider finalization before closing resources', async () => {
  const child = spawn(process.execPath, ['src/testing/shutdown-fixture.ts'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: '0', VOICE_SHUTDOWN: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  // Register before shutdown; the process can exit before the socket finishes reading.
  const exited = once(child, 'exit')

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += String(chunk)
  })
  child.stderr.on('data', (chunk) => {
    output += String(chunk)
  })
  const deadline = setTimeout(() => child.kill('SIGKILL'), 3000)
  try {
    while (!output.includes('API listening')) {
      if (child.exitCode !== null) {
        throw new Error(`API exited: ${output}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    child.kill('SIGTERM')
    const [code] = await exited
    expect(code).toBe(0)
    expect(output).toContain('memory=1 transcript=1 finalization=confirmed')
  } finally {
    clearTimeout(deadline)
    if (child.exitCode === null) {
      child.kill('SIGKILL')
    }
  }
}, 4000)
