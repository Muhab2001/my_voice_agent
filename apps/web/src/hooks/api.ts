import { errorSchema } from '@voice/contracts'
import { useCallback } from 'react'
import type { z } from 'zod'
import { env } from '../env'
import { useAuth } from './auth'

const apiBase = env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? ''

export type ApiRequestInput = {
  path: `/${string}`
  method: 'GET' | 'POST'
  body?: unknown
  signal?: AbortSignal
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public body?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function send(
  { path, method, body, signal }: ApiRequestInput,
  accessToken?: string,
): Promise<Response> {
  const headers = new Headers()

  if (body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }

  return fetch(`${apiBase}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
}

export async function assertOk(response: Response): Promise<void> {
  if (response.ok) {
    return
  }

  const payload: unknown = await response.json().catch(() => null)
  const body = errorSchema.safeParse(payload)

  throw new ApiError(
    body.success
      ? body.data.error.message
      : `Request failed (${response.status})`,
    response.status,
    body.success ? body.data.error.code : undefined,
    payload,
  )
}

export async function readJSON<Schema extends z.ZodTypeAny>(
  response: Response,
  schema: Schema,
): Promise<z.output<Schema>> {
  await assertOk(response)
  return schema.parse(
    response.status === 204 ? undefined : await response.json(),
  )
}

/** Sends cookie-based auth requests and returns their full responses. */
export function usePublicApi() {
  return useCallback(
    async (input: ApiRequestInput): Promise<Response> => send(input),
    [],
  )
}

/** Shares token renewal for authenticated HTTP requests. */
export function useApi() {
  const { getAccessToken } = useAuth()

  const request = useCallback(
    async (input: ApiRequestInput) => {
      const token = await getAccessToken()
      let response = await send(input, token)

      if (response.status === 401) {
        const replacement = await getAccessToken(token)
        response = await send(input, replacement)
      }

      return response
    },
    [getAccessToken],
  )

  return request
}
