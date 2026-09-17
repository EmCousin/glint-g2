import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../src/app.js'

async function startTestServer(overrides = {}) {
  const sent = []
  const reactions = []
  const cursors = []
  const provider = {
    name: 'test',
    async recentConversations(cursor) {
      cursors.push(['conversations', cursor])
      return {
        items: [{ id: 'ada', title: 'Ada', latestMessage: 'Hello' }],
        nextCursor: 'next-conversation',
        hasMore: true,
      }
    },
    async recentMessages(conversationId, cursor) {
      cursors.push(['messages', cursor])
      if (conversationId !== 'ada') return null
      return {
        items: [{ id: '1', conversationId: 'ada', sender: 'Ada', body: 'Hello' }],
        nextCursor: null,
        hasMore: false,
      }
    },
    async resolveReplyTarget(conversationId) {
      return conversationId === 'ada' ? { type: 'test', id: 'ada', label: 'Ada' } : null
    },
    async resolveMessageTarget(conversationId, messageId) {
      return conversationId === 'ada' && messageId === '1'
        ? { id: '1', key: { remoteJid: 'ada', id: '1' }, raw: { body: 'Hello' } }
        : null
    },
  }
  const sender = {
    async send(target, message, quote) {
      sent.push({ target, message, ...(quote ? { quote } : {}) })
    },
    async react(target, message, emoji, remove) {
      reactions.push({ target, message, emoji, remove })
    },
  }
  const transcriber = {
    async transcribe() {
      return 'Voice reply'
    },
  }
  const app = createApp({
    token: 'secret',
    provider,
    sender,
    transcriber,
    now: () => 1_000,
    createId: () => 'draft-1',
    ...overrides,
  })
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address()
  return { server, baseUrl: `http://127.0.0.1:${port}`, sent, reactions, cursors }
}

test('health endpoint is public', async (context) => {
  const { server, baseUrl } = await startTestServer()
  context.after(() => server.close())

  const response = await fetch(`${baseUrl}/health`)

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { status: 'ok', provider: 'test' })
})

test('health and sent replies expose transport metadata', async (context) => {
  const sender = {
    status() { return 'connecting' },
    async send() { return { id: 'wa-message-1', timestamp: 2_000 } },
    async react() {},
  }
  const { server, baseUrl } = await startTestServer({ sender })
  context.after(() => server.close())
  const headers = { Authorization: 'Bearer secret', 'Content-Type': 'application/json' }

  const health = await fetch(`${baseUrl}/health`)
  assert.deepEqual(await health.json(), {
    status: 'connecting',
    provider: 'test',
    connection: 'connecting',
  })

  await fetch(`${baseUrl}/api/replies/drafts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ conversationId: 'ada', message: 'Hello' }),
  })
  const response = await fetch(`${baseUrl}/api/replies/draft-1/confirm`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ confirm: true }),
  })
  assert.equal((await response.json()).message.id, 'wa-message-1')
})

test('debug-log endpoint accepts a message behind the bearer token', async (context) => {
  const { server, baseUrl } = await startTestServer()
  context.after(() => server.close())

  const unauthorized = await fetch(`${baseUrl}/api/debug-log`, { method: 'POST' })
  assert.equal(unauthorized.status, 401)

  const authorized = await fetch(`${baseUrl}/api/debug-log`, {
    method: 'POST',
    headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'hello from the glasses' }),
  })
  assert.equal(authorized.status, 200)
  assert.deepEqual(await authorized.json(), { ok: true })
})

test('conversation endpoints require the bearer token and scope messages', async (context) => {
  const { server, baseUrl, cursors } = await startTestServer()
  context.after(() => server.close())

  const unauthorized = await fetch(`${baseUrl}/api/conversations`)
  assert.equal(unauthorized.status, 401)

  const authorized = await fetch(`${baseUrl}/api/conversations?cursor=conversation-cursor`, {
    headers: { Authorization: 'Bearer secret' },
  })

  assert.equal(authorized.status, 200)
  assert.deepEqual(await authorized.json(), {
    conversations: [{ id: 'ada', title: 'Ada', latestMessage: 'Hello' }],
    nextCursor: 'next-conversation',
    hasMore: true,
  })

  const messages = await fetch(`${baseUrl}/api/conversations/ada/messages?cursor=message-cursor`, {
    headers: { Authorization: 'Bearer secret' },
  })
  assert.equal(messages.status, 200)
  assert.deepEqual(await messages.json(), {
    messages: [{ id: '1', conversationId: 'ada', sender: 'Ada', body: 'Hello' }],
    nextCursor: null,
    hasMore: false,
  })
  assert.deepEqual(cursors, [
    ['conversations', 'conversation-cursor'],
    ['messages', 'message-cursor'],
  ])

  const missing = await fetch(`${baseUrl}/api/conversations/grace/messages`, {
    headers: { Authorization: 'Bearer secret' },
  })
  assert.equal(missing.status, 404)
})

test('reply draft locks the target and text without sending', async (context) => {
  const { server, baseUrl, sent } = await startTestServer()
  context.after(() => server.close())

  const response = await fetch(`${baseUrl}/api/replies/drafts`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer secret',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ conversationId: 'ada', message: '  Yes  ' }),
  })

  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), {
    draftId: 'draft-1',
    recipient: 'Ada',
    message: 'Yes',
    expiresAt: 61_000,
  })
  assert.equal(sent.length, 0)
})

test('reply requires explicit confirmation and sends a draft only once', async (context) => {
  const { server, baseUrl, sent } = await startTestServer()
  context.after(() => server.close())
  const headers = {
    Authorization: 'Bearer secret',
    'Content-Type': 'application/json',
  }

  await fetch(`${baseUrl}/api/replies/drafts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ conversationId: 'ada', message: 'Yes' }),
  })

  const unconfirmed = await fetch(`${baseUrl}/api/replies/draft-1/confirm`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ confirm: false }),
  })
  assert.equal(unconfirmed.status, 400)
  assert.equal(sent.length, 0)

  const confirmed = await fetch(`${baseUrl}/api/replies/draft-1/confirm`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ confirm: true, message: 'tampered' }),
  })
  assert.equal(confirmed.status, 200)
  assert.deepEqual(await confirmed.json(), {
    status: 'sent',
    message: {
      id: 'sent:1000',
      sender: 'You',
      timestamp: 1000,
      body: 'Yes',
      reactions: [],
    },
  })
  assert.deepEqual(sent, [{ target: { type: 'test', id: 'ada', label: 'Ada' }, message: 'Yes' }])

  const replayed = await fetch(`${baseUrl}/api/replies/draft-1/confirm`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ confirm: true }),
  })
  assert.equal(replayed.status, 404)
  assert.equal(sent.length, 1)
})

test('expired reply drafts cannot send', async (context) => {
  let timestamp = 1_000
  const { server, baseUrl, sent } = await startTestServer({ now: () => timestamp })
  context.after(() => server.close())
  const headers = {
    Authorization: 'Bearer secret',
    'Content-Type': 'application/json',
  }

  await fetch(`${baseUrl}/api/replies/drafts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ conversationId: 'ada', message: 'Yes' }),
  })
  timestamp += 60_001

  const response = await fetch(`${baseUrl}/api/replies/draft-1/confirm`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ confirm: true }),
  })

  assert.equal(response.status, 404)
  assert.equal(sent.length, 0)
})

test('dictation creates a locked draft without sending', async (context) => {
  let receivedPcm
  const transcriber = {
    async transcribe(pcm) {
      receivedPcm = pcm
      return '  Dictated reply  '
    },
  }
  const { server, baseUrl, sent } = await startTestServer({ transcriber })
  context.after(() => server.close())

  const response = await fetch(`${baseUrl}/api/replies/dictate`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer secret',
      'Content-Type': 'application/octet-stream',
      'X-Conversation-Id': 'ada',
    },
    body: new Uint8Array([1, 2, 3, 4]),
  })

  assert.equal(response.status, 201)
  assert.deepEqual([...receivedPcm], [1, 2, 3, 4])
  assert.deepEqual(await response.json(), {
    draftId: 'draft-1',
    recipient: 'Ada',
    message: 'Dictated reply',
    expiresAt: 61_000,
  })
  assert.equal(sent.length, 0)
})

test('selected-message dictation locks quoted reply metadata', async (context) => {
  const { server, baseUrl, sent } = await startTestServer()
  context.after(() => server.close())
  const headers = {
    Authorization: 'Bearer secret',
    'Content-Type': 'application/octet-stream',
    'X-Conversation-Id': 'ada',
    'X-Message-Id': '1',
  }

  const draft = await fetch(`${baseUrl}/api/replies/dictate`, {
    method: 'POST',
    headers,
    body: Buffer.from([1, 2]),
  })
  assert.equal(draft.status, 201)

  await fetch(`${baseUrl}/api/replies/draft-1/confirm`, {
    method: 'POST',
    headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: true }),
  })
  assert.deepEqual(sent[0].quote, {
    id: '1',
    key: { remoteJid: 'ada', id: '1' },
    raw: { body: 'Hello' },
  })
})

test('dictation preview transcribes audio without creating or sending a draft', async (context) => {
  const { server, baseUrl, sent } = await startTestServer()
  context.after(() => server.close())

  const response = await fetch(`${baseUrl}/api/replies/dictate/preview`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer secret',
      'Content-Type': 'application/octet-stream',
    },
    body: Buffer.from([1, 2]),
  })

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { text: 'Voice reply' })
  assert.equal(sent.length, 0)
})

test('reaction endpoint targets a known message with an allowed emoji', async (context) => {
  const { server, baseUrl, reactions } = await startTestServer()
  context.after(() => server.close())

  const response = await fetch(`${baseUrl}/api/reactions`, {
    method: 'POST',
    headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId: 'ada', messageId: '1', emoji: '👍' }),
  })

  assert.equal(response.status, 200)
  assert.deepEqual(reactions, [{
    target: { type: 'test', id: 'ada', label: 'Ada' },
    message: { id: '1', key: { remoteJid: 'ada', id: '1' }, raw: { body: 'Hello' } },
    emoji: '👍',
    remove: false,
  }])

  const removed = await fetch(`${baseUrl}/api/reactions`, {
    method: 'POST',
    headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId: 'ada', messageId: '1', emoji: '👍', remove: true }),
  })
  assert.deepEqual(await removed.json(), { status: 'removed' })
  assert.equal(reactions[1].remove, true)
})

test('dictation rejects empty audio and silence', async (context) => {
  const transcriber = { async transcribe() { return '' } }
  const { server, baseUrl, sent } = await startTestServer({ transcriber })
  context.after(() => server.close())
  const headers = {
    Authorization: 'Bearer secret',
    'Content-Type': 'application/octet-stream',
    'X-Conversation-Id': 'ada',
  }

  const empty = await fetch(`${baseUrl}/api/replies/dictate`, {
    method: 'POST',
    headers,
    body: new Uint8Array(),
  })
  assert.equal(empty.status, 400)

  const silent = await fetch(`${baseUrl}/api/replies/dictate`, {
    method: 'POST',
    headers,
    body: new Uint8Array([0, 0]),
  })
  assert.equal(silent.status, 422)
  assert.equal(sent.length, 0)
})
