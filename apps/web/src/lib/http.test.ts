import { expect, mock, spyOn, test } from 'bun:test'
import { z } from 'zod'
import { buildHeaders, fetchAuthenticated, parseJson } from './http'

const input = { path: '/test' as const, method: 'GET' as const }

test('HTTP utilities build JSON and bearer headers and include cookies', async () => {
  const headers = buildHeaders({ body: { hello: true }, accessToken: 'token' })
  expect(headers.get('Content-Type')).toBe('application/json')
  expect(headers.get('Authorization')).toBe('Bearer token')
  expect(buildHeaders({}).has('Authorization')).toBe(false)
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ ok: true }),
  )

  try {
    await fetchAuthenticated(input, async () => 'token')
    expect(fetch.mock.calls[0]?.[1]?.credentials).toBe('include')
    expect(
      new Headers(fetch.mock.calls[0]?.[1]?.headers).get('Authorization'),
    ).toBe('Bearer token')
  } finally {
    fetch.mockRestore()
  }
})

test('401 retries use a replacement token exactly once', async () => {
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(null, { status: 401 }),
  )
  const getToken = mock(async (rejected?: string) => (rejected ? 'new' : 'old'))

  try {
    await expect(fetchAuthenticated(input, getToken)).rejects.toThrow(
      'Request failed (401)',
    )
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(getToken.mock.calls).toEqual([[], ['old']])
    expect(
      new Headers(fetch.mock.calls[1]?.[1]?.headers).get('Authorization'),
    ).toBe('Bearer new')
  } finally {
    fetch.mockRestore()
  }
})

test('network failures are surfaced without refreshing or retrying', async () => {
  const fetch = spyOn(globalThis, 'fetch').mockRejectedValue(
    new TypeError('Offline'),
  )
  const getToken = mock(async () => 'token')

  try {
    await expect(fetchAuthenticated(input, getToken)).rejects.toThrow('Offline')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(getToken).toHaveBeenCalledTimes(1)
  } finally {
    fetch.mockRestore()
  }
})

test('JSON parsing validates responses and supports empty 204 responses', async () => {
  await expect(
    parseJson(
      Response.json({ count: 'wrong' }),
      z.object({ count: z.number() }),
    ),
  ).rejects.toThrow()
  expect(
    await parseJson(new Response(null, { status: 204 }), z.undefined()),
  ).toBeUndefined()
})
