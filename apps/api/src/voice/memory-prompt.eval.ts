import OpenAI from 'openai'
import type { ResponseInputItem } from 'openai/resources/responses/responses'
import { z } from 'zod'
import { liveConfig } from './provider.js'
import { locationTools, memoryTools, reservationTools } from './tools.js'

// Explicit, opt-in model evaluation. Uses synthetic facts only; never reads or writes the app database.
// Run from the repository root: bun --env-file .env apps/api/src/voice/memory-prompt.eval.ts
const client = new OpenAI({ maxRetries: 0, timeout: 30_000 })

if (liveConfig.delegation?.type !== 'responses') {
  throw new Error('Responses delegation is required')
}

const config = liveConfig.delegation.responses
const baselineIndex = Bun.argv.indexOf('--baseline')
const instructions =
  baselineIndex >= 0
    ? ((await Bun.file(Bun.argv[baselineIndex + 1]).json())[1] as string)
    : config.instructions
const searchArguments = z
  .object({
    query: z.string().max(256).nullable(),
    entity: z.string().nullable(),
    from: z.string().datetime({ offset: true }).nullable(),
    to: z.string().datetime({ offset: true }).nullable(),
    limit: z.number().int().min(1).max(20),
  })
  .strict()
const cases = [
  {
    name: 'direct name recall',
    question: 'What is my name?',
    fact: "The user's name is Nora.",
    answer: /Nora/i,
  },
  {
    name: 'name without literal name keyword',
    question: 'What is my name?',
    fact: 'The user said: Call me Rami.',
    answer: /Rami/i,
  },
  {
    name: 'preference synonym',
    question: 'What coffee do I like?',
    fact: 'The user prefers espresso without sugar.',
    answer: /espresso/i,
  },
  {
    name: 'broad personal recall',
    question: 'What do you know about me?',
    fact: 'The user lives in Jeddah.',
    answer: /Jeddah/i,
  },
  {
    name: 'missing fact does not imply no memory access',
    question: 'What is my name?',
    fact: 'The user prefers espresso.',
    answer: null,
  },
]
let passed = 0

for (const scenario of cases) {
  const input: ResponseInputItem[] = [
    { role: 'user', content: scenario.question },
  ]
  const searches: unknown[] = []
  let found = false
  let writes = 0
  let output = ''

  for (let step = 0; step < 8; step += 1) {
    const response = await client.responses.create({
      model: config.model,
      instructions,
      tools: [...memoryTools, ...locationTools, ...reservationTools],
      tool_choice: 'auto',
      parallel_tool_calls: false,
      store: false,
      input,
    })
    for (const item of response.output) {
      if (
        item.type === 'message' ||
        item.type === 'reasoning' ||
        item.type === 'function_call'
      ) {
        input.push(item)
      }
    }
    const calls = response.output.filter(
      (item) => item.type === 'function_call',
    )

    if (calls.length === 0) {
      output = response.output_text
      break
    }

    for (const call of calls) {
      let result: object

      if (call.name === 'search_memory') {
        const args = searchArguments.parse(JSON.parse(call.arguments))
        searches.push(args)
        // Match the database's literal AND keywords, exact entity and exclusion of undated facts.
        const keywords = String(args.query ?? '')
          .trim()
          .toLowerCase()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 8)
        const matches =
          keywords.every((keyword) =>
            scenario.fact.toLowerCase().includes(keyword),
          ) &&
          (!args.entity || args.entity.toLowerCase() === 'profile') &&
          !args.from &&
          !args.to
        found ||= matches
        result = {
          ok: true,
          memories: matches
            ? [
                {
                  id: '00000000-0000-4000-8000-000000000001',
                  content: scenario.fact,
                  entity: 'profile',
                  eventAt: null,
                },
              ]
            : [],
        }
      } else {
        writes += 1
        result = { ok: false, error: 'This recall evaluation is read-only.' }
      }

      input.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(result),
      })
    }
  }

  const correct =
    searches.length > 0 &&
    writes === 0 &&
    Boolean(output) &&
    (scenario.answer
      ? found && scenario.answer.test(output)
      : !/Nora|Rami|Lina|never told|no (?:saved )?memories|(?:no|don.t have) access/i.test(
          output,
        ))
  passed += Number(correct)
  console.log(
    JSON.stringify({
      scenario: scenario.name,
      passed: correct,
      searches,
      output,
    }),
  )
}

console.log(`${passed}/${cases.length} recall scenarios passed`)

if (passed !== cases.length) {
  process.exitCode = 1
}
