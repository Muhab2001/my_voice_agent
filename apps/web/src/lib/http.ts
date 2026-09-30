import { errorSchema } from '@voice/contracts'
import { env } from '../env'

const apiBase = env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? ''

export type HttpRequestInput = {
  path: `/${string}`
  method: 'GET' | 'POST'
  body?: unknown
  accessToken?: string | null
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

/** Builds common JSON and bearer headers; cookies are handled by the browser. */
export function buildHeaders({
  body,
  accessToken,
}: Pick<HttpRequestInput, 'body' | 'accessToken'>): Headers {
  const headers = new Headers()

  if (body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }

  return headers
}

export async function fetchApi({
  path,
  method,
  body,
  accessToken,
  signal,
}: HttpRequestInput): Promise<Response> {
  const headers = buildHeaders({ body, accessToken })

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

/** A token-free request function passed from React hooks to browser transports. */
export type AuthenticatedRequestInput = Omit<HttpRequestInput, 'accessToken'>

export type AuthenticatedFetch = (
  input: AuthenticatedRequestInput,
) => Promise<Response>

/** Gets a valid token per call and retries a rejected token once. */
export async function fetchAuthenticated(
  input: AuthenticatedRequestInput,
  getAccessToken: (rejectedToken?: string) => Promise<string>,
): Promise<Response> {
  const token = await getAccessToken()
  let response = await fetchApi({ ...input, accessToken: token })

  if (response.status === 401) {
    const replacement = await getAccessToken(token)
    response = await fetchApi({ ...input, accessToken: replacement })
  }

  await assertOk(response)
  return response
}

/** Validates JSON responses, including endpoints that return an empty 204. */
export async function parseJson<T>(
  response: Response,
  schema: { parse(value: unknown): T },
): Promise<T> {
  await assertOk(response)
  return schema.parse(
    response.status === 204 ? undefined : await response.json(),
  )
}
