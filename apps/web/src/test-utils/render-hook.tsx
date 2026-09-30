import { act, cleanup, renderHook } from '@testing-library/react/pure'
import { Window } from 'happy-dom'
import type { ComponentType, ReactNode } from 'react'
import { SWRConfig, type SWRConfiguration } from 'swr'
import { AuthContext } from '../auth/auth-provider'

/** Adds isolated browser globals, authentication and SWR cache to RTL's renderHook. */
export async function renderAuthenticatedHook<Props, Result>(
  useHook: (props: Props) => Result,
  props: Props,
  options: {
    wrapper?: ComponentType<{ children: ReactNode }>
    config?: SWRConfiguration
    setup?: (browser: Window) => void
  } = {},
) {
  const browser = new Window({ url: 'http://localhost/' })
  const globals = {
    window: browser,
    document: browser.document,
    navigator: browser.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const previous = Object.keys(globals).map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  )

  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    })
  }

  options.setup?.(browser)
  const cache = new Map()

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthContext.Provider
        value={{
          isAuthenticated: true,
          isLoading: false,
          error: null,
          login: async () => {},
          logout: async () => {},
          getAccessToken: async () => 'token',
        }}
      >
        <SWRConfig value={{ provider: () => cache, ...options.config }}>
          {children}
        </SWRConfig>
      </AuthContext.Provider>
    )
  }

  const hook = renderHook(useHook, {
    initialProps: props,
    wrapper: options.wrapper ?? Wrapper,
  })
  await act(async () => {})

  return {
    ...hook,
    browser,
    async cleanup() {
      cleanup()
      await browser.happyDOM.close()

      for (const [name, descriptor] of previous) {
        if (descriptor) {
          Object.defineProperty(globalThis, name, descriptor)
        } else {
          Reflect.deleteProperty(globalThis, name)
        }
      }
    },
  }
}
