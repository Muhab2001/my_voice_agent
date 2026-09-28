import { expect, test } from 'bun:test'
import { liveConfig } from './provider.js'

test('voice and memory configuration stays server-owned; frontend cannot receive or submit private tools', () => {
  expect(liveConfig.model).toBe('gpt-live-1')

  expect(liveConfig.delegation?.type).toBe('responses')
  if (liveConfig.delegation?.type !== 'responses') {
    throw new Error('Responses delegation required')
  }

  expect(liveConfig.delegation.responses.model).toBe('gpt-6-luna')

  expect(
    liveConfig.delegation.responses.tools?.map((tool) =>
      tool.type === 'function' ? tool.name : '',
    ),
  ).toEqual(['search_memory', 'remember_fact', 'correct_memory'])

  expect(liveConfig.client?.data_channel.allowed_client_events).toEqual([])

  expect(
    liveConfig.client?.data_channel.allowed_server_events,
  ).not.toContainEqual({ type: 'response.event' })
})
