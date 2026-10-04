import { expect, spyOn, test } from 'bun:test'
import { z } from 'zod'
import { renderAuthenticatedHook } from '../test-utils/render-hook'
import { type ApiError, readJSON, useApi, usePublicApi } from './api'

test('protected API requests return the response; callers validate JSON', async () => {
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ count: 2 }, { headers: { 'X-Request-Id': 'request-1' } }),
  )
  const app = await renderAuthenticatedHook(useApi, undefined)

  try {
    const result = await app.result.current({
      path: '/test',
      method: 'POST',
      body: { hello: true },
    })

    expect(result.status).toBe(200)
    expect(result.headers.get('X-Request-Id')).toBe('request-1')
    expect(await readJSON(result, z.object({ count: z.number() }))).toEqual({
      count: 2,
    })
    expect(fetch.mock.calls[0]?.[1]?.credentials).toBe('include')
    expect(
      new Headers(fetch.mock.calls[0]?.[1]?.headers).get('Authorization'),
    ).toBe('Bearer token')
    expect(
      new Headers(fetch.mock.calls[0]?.[1]?.headers).get('Content-Type'),
    ).toBe('application/json')
    expect(fetch.mock.calls[0]?.[1]?.body).toBe('{"hello":true}')
  } finally {
    await app.cleanup()
    fetch.mockRestore()
  }
})

test('public API requests return full responses; readJSON validates and reports errors', async () => {
  const fetch = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(
      Response.json(
        { error: { code: 'invalid', message: 'Bad request', requestId: 'id' } },
        { status: 400 },
      ),
    )
  const app = await renderAuthenticatedHook(usePublicApi, undefined)

  try {
    const empty = await app.result.current({
      path: '/test',
      method: 'GET',
    })
    expect(empty.status).toBe(204)
    expect(await readJSON(empty, z.undefined())).toBeUndefined()
    const failed = await app.result.current({
      path: '/test',
      method: 'GET',
    })
    expect(failed.status).toBe(400)
    await expect(readJSON(failed, z.unknown())).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      code: 'invalid',
      message: 'Bad request',
    } satisfies Partial<ApiError>)
  } finally {
    await app.cleanup()
    fetch.mockRestore()
  }
})
