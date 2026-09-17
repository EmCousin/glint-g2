import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { createWhatsAppTransport } from '../src/whatsapp.js'

test('WhatsApp transport wires events and sends replies and reactions with native keys', async () => {
  const events = new EventEmitter()
  const calls = []
  const ingested = []
  const sent = {
    key: { remoteJid: '15551111111@s.whatsapp.net', id: 'sent-1', fromMe: true },
    messageTimestamp: 1_700_000_000,
    message: { conversation: 'Reply' },
  }
  const socket = {
    ev: events,
    async sendMessage(...args) {
      calls.push(args)
      return sent
    },
    end() {},
  }
  const provider = {
    ingestHistory(history) { ingested.push(['history', history]) },
    ingestMessages(messages) { ingested.push(['messages', messages]) },
    ingestMessageUpdates() {},
    deleteMessages() {},
    ingestReactions() {},
    ingestContacts() {},
    ingestChats() {},
    deleteChats() {},
    async resolveMessageTarget() { return null },
    async findMessageTarget() { return null },
    async flush() {},
  }
  const transport = createWhatsAppTransport({
    provider,
    makeSocket: () => socket,
    loadAuth: async () => ({
      state: { creds: { registered: true }, keys: {} },
      saveCreds: async () => {},
    }),
    latestVersion: async () => ({ version: [2, 3000, 1] }),
    cacheKeyStore: (keys) => keys,
  })
  await transport.start()
  events.emit('connection.update', { connection: 'open' })

  events.emit('messaging-history.set', { chats: [{ id: 'chat' }] })
  assert.deepEqual(ingested[0], ['history', { chats: [{ id: 'chat' }] }])

  const quote = { raw: { key: { id: 'quoted' }, message: { conversation: 'Original' } } }
  const result = await transport.send({ jid: '15551111111@s.whatsapp.net' }, 'Reply', quote)
  assert.equal(result.timestamp, 1_700_000_000_000)
  assert.deepEqual(calls[0], [
    '15551111111@s.whatsapp.net',
    { text: 'Reply' },
    { quoted: quote.raw },
  ])

  const key = { remoteJid: '15551111111@s.whatsapp.net', id: 'original', fromMe: false }
  await transport.react({ jid: '15551111111@s.whatsapp.net' }, { key }, '👍', true)
  assert.deepEqual(calls[1], [
    '15551111111@s.whatsapp.net',
    { react: { text: '', key } },
  ])
  await transport.stop()
})
