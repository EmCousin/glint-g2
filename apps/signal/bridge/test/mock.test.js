import assert from 'node:assert/strict'
import test from 'node:test'
import { mockProvider } from '../src/providers/mock.js'

test('mock provider implements the paginated provider contract', async () => {
  const conversations = await mockProvider.recentConversations()
  const messages = await mockProvider.recentMessages('ada')

  assert.equal(conversations.items.length, 3)
  assert.equal(conversations.nextCursor, null)
  assert.equal(conversations.hasMore, false)
  assert.equal(messages.items.length, 2)
  assert.equal(messages.nextCursor, null)
  assert.equal(messages.hasMore, false)
  assert.equal(await mockProvider.recentMessages('missing'), null)
})
