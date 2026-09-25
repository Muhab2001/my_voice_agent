import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export function loadScriptsEnv(runtimeEnv: NodeJS.ProcessEnv = process.env) {
  return createEnv({
    server: {
      DATABASE_URL: z.string().url(),
    },
    runtimeEnv,
    emptyStringAsUndefined: true,
  })
}
