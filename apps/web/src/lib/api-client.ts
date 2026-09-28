import { authResponseSchema, type loginSchema } from '@voice/contracts'
import type { z } from 'zod'
import { assertOk, fetchApi } from './http'

export type AuthSession = z.output<typeof authResponseSchema>
export type LoginInput = z.input<typeof loginSchema>
export const AUTH_REFRESH_BUFFER_MS = 60_000

export type GetInput<T> = {
  path: `/${string}`
  schema: { parse(value: unknown): T }
  authenticated?: boolean
}

export interface ApiClientInterface {
  login(input: LoginInput): Promise<AuthSession>
  refresh(): Promise<AuthSession>
  logout(): Promise<void>
  get<T>(input: GetInput<T>): Promise<T>
  clearAccessToken(): void
}

// biome-ignore lint/complexity/noStaticOnlyClass: This is the requested static API facade.
export class ApiClient {
  private static accessToken: string | null = null
  private static accessTokenExpiresAt = 0
  private static refreshPromise: Promise<AuthSession> | null = null

  private static async requestAuth(
    path: '/v1/auth/login' | '/v1/auth/refresh',
    body?: LoginInput,
  ): Promise<AuthSession> {
    const response = await fetchApi({ path, method: 'POST', body })
    await assertOk(response)
    const session = authResponseSchema.parse(await response.json())
    ApiClient.accessToken = session.accessToken
    ApiClient.accessTokenExpiresAt = Date.parse(session.expiresAt)
    return session
  }

  static login(input: LoginInput): Promise<AuthSession> {
    return ApiClient.requestAuth('/v1/auth/login', input)
  }

  static refresh(): Promise<AuthSession> {
    if (!ApiClient.refreshPromise) {
      ApiClient.refreshPromise = ApiClient.requestAuth(
        '/v1/auth/refresh',
      ).finally(() => {
        ApiClient.refreshPromise = null
      })
    }
    return ApiClient.refreshPromise
  }

  static async logout(): Promise<void> {
    ApiClient.clearAccessToken()
    await assertOk(await fetchApi({ path: '/v1/auth/logout', method: 'POST' }))
  }

  static async get<T>({
    path,
    schema,
    authenticated = false,
  }: GetInput<T>): Promise<T> {
    if (
      authenticated &&
      (!ApiClient.accessToken ||
        ApiClient.accessTokenExpiresAt - Date.now() <= AUTH_REFRESH_BUFFER_MS)
    ) {
      await ApiClient.refresh()
    }

    const send = () =>
      fetchApi({
        path,
        method: 'GET',
        accessToken: authenticated ? ApiClient.accessToken : null,
      })
    let response = await send()
    if (response.status === 401 && authenticated) {
      await ApiClient.refresh()
      response = await send()
    }
    await assertOk(response)
    return schema.parse(await response.json())
  }

  static async post<T>(
    path: `/${string}`,
    body: unknown,
    schema: { parse(value: unknown): T },
  ): Promise<T> {
    if (
      !ApiClient.accessToken ||
      ApiClient.accessTokenExpiresAt - Date.now() <= AUTH_REFRESH_BUFFER_MS
    ) {
      await ApiClient.refresh()
    }
    const send = () =>
      fetchApi({
        path,
        method: 'POST',
        body,
        accessToken: ApiClient.accessToken,
      })
    let response = await send()
    if (response.status === 401) {
      await ApiClient.refresh()
      response = await send()
    }
    await assertOk(response)
    return schema.parse(
      response.status === 204 ? undefined : await response.json(),
    )
  }

  static clearAccessToken(): void {
    ApiClient.accessToken = null
    ApiClient.accessTokenExpiresAt = 0
  }
}

export const apiClient: ApiClientInterface = ApiClient
