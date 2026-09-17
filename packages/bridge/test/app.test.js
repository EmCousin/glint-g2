import assert from 'node:assert/strict'
import test from 'node:test'
import { createBridgeApp } from '../index.js'

async function startTestServer(capabilities) {
  const sent = []
  const reactions = []
  const provider = {
    name: 'test',
    async resolveReplyTarget() {
      return { id: 'ada', label: 'Ada' }
    },
    async resolveMessageTarget() {
      return { id: 'message-1' }
    },
  }
  const sender = {
    async send(target, message, quote) {
      sent.push({ target, message, quote })
    },
    async react(target, message, emoji, remove) {
      reactions.push({ target, message, emoji, remove })
    },
  }
  const app = createBridgeApp({
    token: 'secret',
    provider,
    sender,
    transcriber: { async transcribe() { return 'Voice reply' } },
    capabilities,
    now: () => 1_000,
    createId: () => 'draft-1',
  })
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}`, sent, reactions }
}

test('quoted replies and reactions are gated by explicit capabilities', async (context) => {
  const disabled = await startTestServer({ quotedReplies: false, reactions: false })
  context.after(() => disabled.server.close())
  const headers = { Authorization: 'Bearer secret', 'Content-Type': 'application/json' }

  await fetch(`${disabled.baseUrl}/api/replies/drafts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ conversationId: 'ada', message: 'Hello', messageId: 'message-1' }),
  })
  await fetch(`${disabled.baseUrl}/api/replies/draft-1/confirm`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ confirm: true }),
  })
  const unavailableReaction = await fetch(`${disabled.baseUrl}/api/reactions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ conversationId: 'ada', messageId: 'message-1', emoji: '👍' }),
  })

  assert.equal(disabled.sent[0].quote, undefined)
  assert.equal(unavailableReaction.status, 404)

  const enabled = await startTestServer({ quotedReplies: true, reactions: true })
  context.after(() => enabled.server.close())
  await fetch(`${enabled.baseUrl}/api/replies/drafts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ conversationId: 'ada', message: 'Hello', messageId: 'message-1' }),
  })
  await fetch(`${enabled.baseUrl}/api/replies/draft-1/confirm`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ confirm: true }),
  })
  const reaction = await fetch(`${enabled.baseUrl}/api/reactions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ conversationId: 'ada', messageId: 'message-1', emoji: '👍' }),
  })

  assert.deepEqual(enabled.sent[0].quote, { id: 'message-1' })
  assert.equal(reaction.status, 200)
  assert.equal(enabled.reactions.length, 1)
})
