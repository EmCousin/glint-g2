import assert from 'node:assert/strict'
import test from 'node:test'
import { createBridgeClient } from '../src/api.js'

test('conversation APIs authenticate and scope message requests', async () => {
  const urls = []
  const fetchImpl = async (url, options) => {
    urls.push(url)
    assert.equal(options.headers.Authorization, 'Bearer secret')
    assert.equal(options.cache, 'no-store')
    return new Response(JSON.stringify(url.endsWith('/conversations')
      ? { conversations: [{ id: 'ada' }] }
      : { messages: [{ id: '1' }] }))
  }

  const client = createBridgeClient({
    baseUrl: 'https://bridge.test',
    token: 'secret',
    fetchImpl,
  })

  assert.deepEqual(await client.recentConversations(), { conversations: [{ id: 'ada' }] })
  assert.deepEqual(await client.recentMessages('ada/slash'), { messages: [{ id: '1' }] })
  assert.deepEqual(urls, [
    'https://bridge.test/api/conversations',
    'https://bridge.test/api/conversations/ada%2Fslash/messages',
  ])
})

test('conversation APIs encode pagination cursors', async () => {
  const urls = []
  const client = createBridgeClient({
    baseUrl: 'https://bridge.test',
    token: 'secret',
    fetchImpl: async (url) => {
      urls.push(new URL(url))
      return new Response(JSON.stringify({ conversations: [], messages: [] }))
    },
  })

  await client.recentConversations('next page/token')
  await client.recentMessages('thread/1', 'older page/token')

  assert.equal(urls[0].searchParams.get('cursor'), 'next page/token')
  assert.equal(urls[1].pathname, '/api/conversations/thread%2F1/messages')
  assert.equal(urls[1].searchParams.get('cursor'), 'older page/token')
})

test('health API is available to every plugin', async () => {
  const client = createBridgeClient({
    baseUrl: 'https://bridge.test',
    token: 'secret',
    fetchImpl: async (url) => {
      assert.equal(url, 'https://bridge.test/health')
      return new Response(JSON.stringify({ status: 'ok', provider: 'signal' }))
    },
  })

  assert.deepEqual(await client.health(), { status: 'ok', provider: 'signal' })
})

test('reply client drafts and explicitly confirms an immutable reply', async () => {
  const requests = []
  const fetchImpl = async (url, options) => {
    requests.push({ url, options })
    return new Response(JSON.stringify(url.endsWith('/drafts') ? { draftId: 'draft-1' } : { status: 'sent' }))
  }
  const client = createBridgeClient({
    baseUrl: 'https://bridge.test',
    token: 'secret',
    fetchImpl,
  })

  assert.deepEqual(await client.createReplyDraft('ada', 'Yes'), { draftId: 'draft-1' })
  assert.deepEqual(await client.confirmReply('draft-1'), { status: 'sent' })
  assert.deepEqual(JSON.parse(requests[0].options.body), { conversationId: 'ada', message: 'Yes' })
  assert.deepEqual(JSON.parse(requests[1].options.body), { confirm: true })
})

test('reply client uploads glasses PCM for dictation', async () => {
  let request
  const fetchImpl = async (url, options) => {
    request = { url, options }
    return new Response(JSON.stringify({ draftId: 'voice-draft' }))
  }
  const client = createBridgeClient({
    baseUrl: 'https://bridge.test',
    token: 'secret',
    fetchImpl,
  })
  const pcm = new Uint8Array([1, 2, 3, 4])

  assert.deepEqual(await client.dictateReply('ada', pcm, 'message-1'), { draftId: 'voice-draft' })
  assert.equal(request.url, 'https://bridge.test/api/replies/dictate')
  assert.equal(request.options.headers['Content-Type'], 'application/octet-stream')
  assert.equal(request.options.headers['X-Conversation-Id'], 'ada')
  assert.equal(request.options.headers['X-Message-Id'], 'message-1')
  assert.equal(request.options.body, pcm)
})

test('reply client requests progressive dictation previews', async () => {
  let request
  const client = createBridgeClient({
    baseUrl: 'https://bridge.test',
    token: 'secret',
    fetchImpl: async (url, options) => {
      request = { url, options }
      return new Response(JSON.stringify({ text: 'Partial reply' }))
    },
  })
  const pcm = new Uint8Array([1, 2, 3, 4])

  assert.deepEqual(await client.previewDictation(pcm), { text: 'Partial reply' })
  assert.equal(request.url, 'https://bridge.test/api/replies/dictate/preview')
  assert.equal(request.options.headers['Content-Type'], 'application/octet-stream')
  assert.equal(request.options.body, pcm)
})

test('reaction client sends the selected message and emoji', async () => {
  let request
  const client = createBridgeClient({
    baseUrl: 'https://bridge.test',
    token: 'secret',
    fetchImpl: async (url, options) => {
      request = { url, options }
      return new Response(JSON.stringify({ status: 'sent' }))
    },
  })

  assert.deepEqual(await client.react('ada', 'message-1', '👍'), { status: 'sent' })
  assert.equal(request.url, 'https://bridge.test/api/reactions')
  assert.deepEqual(JSON.parse(request.options.body), {
    conversationId: 'ada',
    messageId: 'message-1',
    emoji: '👍',
    remove: false,
  })
})

test('debugLog posts a message to the bridge', async () => {
  let request
  const client = createBridgeClient({
    baseUrl: 'https://bridge.test',
    token: 'secret',
    fetchImpl: async (url, options) => {
      request = { url, options }
      return new Response(JSON.stringify({ ok: true }))
    },
  })

  assert.deepEqual(await client.debugLog('hello'), { ok: true })
  assert.equal(request.url, 'https://bridge.test/api/debug-log')
  assert.deepEqual(JSON.parse(request.options.body), { message: 'hello' })
})
