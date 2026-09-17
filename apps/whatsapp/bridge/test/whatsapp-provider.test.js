import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createWhatsAppProvider, encodeMessageKey } from '../src/providers/whatsapp.js'

function textMessage({
  jid,
  id,
  text,
  timestamp,
  fromMe = false,
  participant,
  pushName,
  contextInfo,
}) {
  return {
    key: { remoteJid: jid, id, fromMe, ...(participant ? { participant } : {}) },
    messageTimestamp: timestamp,
    pushName,
    message: contextInfo
      ? { extendedTextMessage: { text, contextInfo } }
      : { conversation: text },
  }
}

test('WhatsApp provider maps direct and group history to the glasses contract', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'glint-whatsapp-'))
  const provider = await createWhatsAppProvider({ dataPath: join(directory, 'store.json') })
  const direct = textMessage({
    jid: '15551111111@s.whatsapp.net',
    id: 'direct-1',
    text: 'Hello',
    timestamp: 1_700_000_000,
    pushName: 'Ada',
  })
  const group = textMessage({
    jid: '120363000000@g.us',
    id: 'group-1',
    text: 'Lunch?',
    timestamp: 1_700_000_100,
    participant: '15552222222@s.whatsapp.net',
  })

  provider.ingestHistory({
    chats: [{ id: '120363000000@g.us', name: 'Team' }],
    contacts: [{ id: '15552222222@s.whatsapp.net', name: 'Grace' }],
    messages: [direct, group],
  })

  assert.deepEqual((await provider.recentConversations()).items.map(({ id, title, latestMessage }) => ({ id, title, latestMessage })), [
    { id: '120363000000@g.us', title: 'Team', latestMessage: 'Grace: Lunch?' },
    { id: '15551111111@s.whatsapp.net', title: 'Ada', latestMessage: 'Hello' },
  ])
  const [message] = (await provider.recentMessages('15551111111@s.whatsapp.net')).items
  assert.equal(message.id, encodeMessageKey(direct.key))
  assert.equal(message.sender, 'Ada')
  assert.equal(message.timestamp, 1_700_000_000_000)
  assert.equal('raw' in message, false)
  assert.equal('key' in message, false)
})

test('WhatsApp provider resolves native targets, quotes, and reactions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'glint-whatsapp-'))
  const provider = await createWhatsAppProvider({ dataPath: join(directory, 'store.json') })
  const original = textMessage({
    jid: '15551111111@s.whatsapp.net',
    id: 'original',
    text: 'Original',
    timestamp: 1_700_000_000,
    pushName: 'Ada',
  })
  const reply = textMessage({
    jid: '15551111111@s.whatsapp.net',
    id: 'reply',
    text: 'Reply',
    timestamp: 1_700_000_100,
    fromMe: true,
    contextInfo: {
      participant: '15551111111@s.whatsapp.net',
      stanzaId: 'original',
      quotedMessage: { conversation: 'Original' },
    },
  })
  provider.ingestMessages([original, reply, {
    key: { remoteJid: '15551111111@s.whatsapp.net', id: 'reaction', fromMe: true },
    messageTimestamp: 1_700_000_200,
    message: { reactionMessage: { key: original.key, text: '👍' } },
  }])
  provider.ingestReactions([{
    key: original.key,
    reaction: {
      key: { remoteJid: original.key.remoteJid, id: 'reaction-update', fromMe: true },
      text: '❤️',
    },
  }])

  const conversationId = '15551111111@s.whatsapp.net'
  const originalId = encodeMessageKey(original.key)
  assert.deepEqual(await provider.resolveReplyTarget(conversationId), { jid: conversationId, label: 'Ada' })
  assert.deepEqual((await provider.resolveMessageTarget(conversationId, originalId)).key, original.key)

  const { items: messages } = await provider.recentMessages(conversationId)
  assert.deepEqual(messages.find(({ id }) => id === originalId).reactions, [{ senderId: 'self', emoji: '❤️' }])
  assert.deepEqual(messages.find(({ body }) => body === 'Reply').quote, {
    sender: 'Ada',
    senderId: '15551111111@s.whatsapp.net',
    body: 'Original',
  })
})

test('WhatsApp provider represents media and applies message updates and deletions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'glint-whatsapp-'))
  const provider = await createWhatsAppProvider({ dataPath: join(directory, 'store.json') })
  const key = { remoteJid: '15551111111@s.whatsapp.net', id: 'photo', fromMe: false }
  provider.ingestMessages([{
    key,
    messageTimestamp: 1_700_000_000,
    pushName: 'Ada',
    message: { imageMessage: {} },
  }])
  assert.equal((await provider.recentMessages(key.remoteJid)).items[0].body, 'Photo')

  provider.ingestMessageUpdates([{
    key: { ...key, participant: '15551111111:4@s.whatsapp.net' },
    update: { message: { extendedTextMessage: { text: 'Edited caption' } } },
  }])
  assert.equal((await provider.recentMessages(key.remoteJid)).items[0].body, 'Edited caption')

  provider.deleteMessages({ keys: [key] })
  assert.deepEqual((await provider.recentMessages(key.remoteJid)).items, [])
  assert.equal(await provider.resolveMessageTarget(key.remoteJid, encodeMessageKey(key)), null)
})

test('WhatsApp provider restores its persisted message snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'glint-whatsapp-'))
  const dataPath = join(directory, 'store.json')
  const provider = await createWhatsAppProvider({ dataPath })
  provider.ingestMessages([textMessage({
    jid: '15551111111@s.whatsapp.net',
    id: 'persisted',
    text: 'Still here',
    timestamp: 1_700_000_000,
    pushName: 'Ada',
  })])
  await provider.flush()

  const restored = await createWhatsAppProvider({ dataPath })

  assert.equal((await restored.recentConversations()).items[0].latestMessage, 'Still here')
  assert.equal((await restored.recentMessages('15551111111@s.whatsapp.net')).items[0].body, 'Still here')
})

test('WhatsApp provider paginates conversations with insertion-stable cursors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'glint-whatsapp-'))
  const provider = await createWhatsAppProvider({ dataPath: join(directory, 'store.json'), limit: 2 })
  provider.ingestMessages([1, 2, 3, 4].map((number) => textMessage({
    jid: `${number}@s.whatsapp.net`,
    id: `message-${number}`,
    text: `Message ${number}`,
    timestamp: 1_700_000_000 + number,
  })))

  const first = await provider.recentConversations()
  assert.deepEqual(first.items.map(({ id }) => id), ['4@s.whatsapp.net', '3@s.whatsapp.net'])
  assert.equal(first.hasMore, true)
  assert.match(first.nextCursor, /^[A-Za-z0-9_-]+$/)

  provider.ingestMessages([textMessage({
    jid: '5@s.whatsapp.net',
    id: 'message-5',
    text: 'Inserted later',
    timestamp: 1_700_000_005,
  })])
  const second = await provider.recentConversations(first.nextCursor)
  assert.deepEqual(second.items.map(({ id }) => id), ['2@s.whatsapp.net', '1@s.whatsapp.net'])
  assert.deepEqual({ nextCursor: second.nextCursor, hasMore: second.hasMore }, { nextCursor: null, hasMore: false })
})

test('WhatsApp provider paginates all retained messages', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'glint-whatsapp-'))
  const provider = await createWhatsAppProvider({ dataPath: join(directory, 'store.json'), limit: 40 })
  const jid = '15551111111@s.whatsapp.net'
  provider.ingestMessages(Array.from({ length: 105 }, (_, index) => textMessage({
    jid,
    id: `message-${index}`,
    text: `Message ${index}`,
    timestamp: 1_700_000_000 + index,
  })))

  const first = await provider.recentMessages(jid)
  const second = await provider.recentMessages(jid, first.nextCursor)
  const third = await provider.recentMessages(jid, second.nextCursor)

  assert.deepEqual([first.items.length, second.items.length, third.items.length], [40, 40, 20])
  assert.deepEqual([first.hasMore, second.hasMore, third.hasMore], [true, true, false])
  assert.equal(new Set([...first.items, ...second.items, ...third.items].map(({ id }) => id)).size, 100)
})
