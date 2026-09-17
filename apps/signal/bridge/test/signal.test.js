import assert from 'node:assert/strict'
import test from 'node:test'
import { createSignalSender, signalEnvelopeFromNotification } from '../src/signal.js'

test('signalEnvelopeFromNotification unwraps automatic and subscribed receive events', () => {
  const envelope = { timestamp: 900, dataMessage: { message: 'Hello' } }

  assert.deepEqual(signalEnvelopeFromNotification({
    method: 'receive',
    params: { account: '+15550000000', envelope },
  }), { account: '+15550000000', envelope })
  assert.deepEqual(signalEnvelopeFromNotification({
    method: 'receive',
    params: { subscription: 0, result: { account: '+15550000000', envelope } },
  }), { account: '+15550000000', envelope })
  assert.equal(signalEnvelopeFromNotification({ method: 'other' }), null)
})

test('Signal sender resolves direct UUIDs to registered recipients', async () => {
  const requests = []
  const sender = createSignalSender({
    account: '+15550000000',
    request: async (method, params) => {
      requests.push({ method, params })
      if (method === 'listContacts') {
        return [{ uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', number: '+15551111111' }]
      }
      return { timestamp: 1 }
    },
  })

  await sender.send({ type: 'direct', recipientUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }, 'Hello')

  assert.deepEqual(requests, [
    { method: 'listContacts', params: { account: '+15550000000' } },
    {
      method: 'send',
      params: { account: '+15550000000', message: 'Hello', recipient: ['+15551111111'] },
    },
  ])
})

test('Signal sender uses group IDs without contact lookup', async () => {
  const requests = []
  const sender = createSignalSender({
    account: '+15550000000',
    request: async (method, params) => {
      requests.push({ method, params })
      return { timestamp: 1 }
    },
  })

  await sender.send({ type: 'group', groupId: 'group-id=' }, 'Hello team')

  assert.deepEqual(requests, [{
    method: 'send',
    params: { account: '+15550000000', message: 'Hello team', groupId: 'group-id=' },
  }])
})

test('Signal sender reacts to an own direct message with the selected account', async () => {
  const requests = []
  const sender = createSignalSender({
    account: '+15550000000',
    request: async (method, params) => {
      requests.push({ method, params })
      if (method === 'listContacts') {
        return [{ uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', number: '+15551111111' }]
      }
      return { timestamp: 1 }
    },
  })

  await sender.react(
    { type: 'direct', recipientUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    { timestamp: 900, senderUuid: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff' },
    '👍',
  )

  assert.equal(requests.at(-1).params.targetAuthor, '+15550000000')
})

test('Signal sender reacts to a specific group message', async () => {
  const requests = []
  const sender = createSignalSender({
    account: '+15550000000',
    request: async (method, params) => {
      requests.push({ method, params })
      if (method === 'listContacts') {
        return [{ uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', number: '+15551111111' }]
      }
      return { timestamp: 1 }
    },
  })

  await sender.react(
    { type: 'group', groupId: 'group-id=' },
    { timestamp: 900, senderUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    '👍',
    true,
  )

  assert.deepEqual(requests, [
    { method: 'listContacts', params: { account: '+15550000000' } },
    {
      method: 'sendReaction',
      params: {
        account: '+15550000000',
        emoji: '👍',
        targetTimestamp: 900,
        targetAuthor: '+15551111111',
        groupId: 'group-id=',
        remove: true,
      },
    },
  ])
})

test('Signal sender retries one transient reaction failure', async () => {
  let attempts = 0
  const sender = createSignalSender({
    account: '+15550000000',
    request: async (method) => {
      if (method === 'listContacts') {
        return [{ uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', number: '+15551111111' }]
      }
      attempts += 1
      if (attempts === 1) throw new Error('daemon warming up')
      return { timestamp: 1 }
    },
  })

  await sender.react(
    { type: 'group', groupId: 'group-id=' },
    { timestamp: 900, senderUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    '👍',
  )

  assert.equal(attempts, 2)
})
