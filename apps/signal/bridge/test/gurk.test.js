import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createGurkProvider,
  decodeGurkReactions,
  mapGurkConversation,
  mapGurkMessage,
} from '../src/providers/gurk.js'

test('mapGurkMessage maps database rows to the plugin contract', () => {
  const message = mapGurkMessage({
    conversation_id: 'aabb',
    timestamp: 1_700_000_000_000,
    sender: 'Ada',
    sender_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    reactions_hex: '0110D89666D0A2DE412489461BCF73807B2204F09F918D',
    body: 'Hello',
  })

  assert.equal(message.id, 'aabb:1700000000000')
  assert.equal(message.conversationId, 'aabb')
  assert.equal(message.sender, 'Ada')
  assert.equal(message.senderId, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  assert.equal(message.timestamp, 1_700_000_000_000)
  assert.equal(message.body, 'Hello')
  assert.deepEqual(message.reactions, [{ senderId: 'd89666d0a2de412489461bcf73807b22', emoji: '👍' }])
  assert.equal(message.quote, null)
  assert.ok(message.time.length > 0)
})

test('mapGurkMessage resolves a quoted message from the joined columns', () => {
  const message = mapGurkMessage({
    conversation_id: 'aabb',
    timestamp: 1_700_000_000_000,
    sender: 'Ada',
    body: 'Sounds good',
    quote_timestamp: 1_699_999_000_000,
    quote_sender: 'Grace',
    quote_body: 'Are we still on for lunch?',
  })

  assert.deepEqual(message.quote, {
    timestamp: 1_699_999_000_000,
    sender: 'Grace',
    body: 'Are we still on for lunch?',
  })
})

test('decodeGurkReactions decodes Gurk postcard reaction vectors', () => {
  assert.deepEqual(
    decodeGurkReactions('0210D89666D0A2DE412489461BCF73807B2204F09F98AE104C9B203188454EC7BE15F785037BC25804F09F918D'),
    [
      { senderId: 'd89666d0a2de412489461bcf73807b22', emoji: '😮' },
      { senderId: '4c9b203188454ec7be15f785037bc258', emoji: '👍' },
    ],
  )
})

test('mapGurkConversation includes the group sender in its latest-message preview', () => {
  const conversation = mapGurkConversation({
    conversation_id: 'aabb',
    title: 'Team',
    timestamp: 1_700_000_000_000,
    sender: 'Ada',
    body: 'Hello',
    reactions_hex: '0110D89666D0A2DE412489461BCF73807B2204F09F918D',
    is_group: 1,
  })

  assert.equal(conversation.id, 'aabb')
  assert.equal(conversation.title, 'Team')
  assert.equal(conversation.timestamp, 1_700_000_000_000)
  assert.equal(conversation.latestMessage, 'Ada: Hello')
  assert.deepEqual(conversation.reactions, [{ senderId: 'd89666d0a2de412489461bcf73807b22', emoji: '👍' }])
  assert.ok(conversation.time.length > 0)
})

test('Gurk provider reads configuration and performs a bounded read-only query', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'glint-signal-'))
  const configPath = join(directory, 'gurk.toml')
  await writeFile(configPath, 'passphrase = "secret"\n')
  let queryOptions
  const provider = createGurkProvider({
    env: {
      GURK_CONFIG: configPath,
      GURK_DATA_DIR: directory,
      SQLCIPHER_PATH: '/custom/sqlcipher',
    },
    limit: 500,
    query: async (options) => {
      queryOptions = options
      return [{
        conversation_id: 'aabb',
        timestamp: 1_700_000_000_000,
        sender: 'Ada',
        body: 'Hello',
      }]
    },
  })

  const page = await provider.recentMessages('4948758b6d7e44d99caf24db2137eefe')

  assert.equal(page.items.length, 1)
  assert.equal(page.nextCursor, null)
  assert.equal(page.hasMore, false)
  assert.equal(queryOptions.executable, '/custom/sqlcipher')
  assert.equal(queryOptions.databasePath, join(directory, 'gurk.sqlite'))
  assert.equal(queryOptions.passphrase, 'secret')
  assert.match(queryOptions.sql, /messages\.deleted = 0/)
  assert.match(queryOptions.sql, /lower\(hex\(messages\.channel_id\)\) =/)
  assert.match(queryOptions.sql, /LEFT JOIN messages AS quoted ON quoted\.channel_id = messages\.channel_id AND quoted\.arrived_at = messages\.quote/)
  assert.match(queryOptions.sql, /messages\.message AS body/)
  assert.match(queryOptions.sql, /quoted\.message AS quote_body/)
  assert.doesNotMatch(queryOptions.sql, /substr\(/)
  assert.match(queryOptions.sql, /LIMIT 101/)
})

test('Gurk provider returns one latest message per conversation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'glint-signal-'))
  const configPath = join(directory, 'gurk.toml')
  await writeFile(configPath, 'passphrase = "secret"\n')
  let sql
  const provider = createGurkProvider({
    env: { GURK_CONFIG: configPath, GURK_DATA_DIR: directory },
    query: async (options) => {
      sql = options.sql
      return [{
        conversation_id: 'aabb',
        title: 'Ada',
        timestamp: 1_700_000_000_000,
        sender: 'Ada',
        body: 'Latest',
        is_group: 0,
      }]
    },
  })

  const page = await provider.recentConversations()

  assert.equal(page.items.length, 1)
  assert.equal(page.items[0].latestMessage, 'Latest')
  assert.equal(page.nextCursor, null)
  assert.equal(page.hasMore, false)
  assert.match(sql, /row_number\(\) OVER/)
  assert.match(sql, /WHERE position = 1/)
  assert.match(sql, /ORDER BY timestamp DESC, conversation_id DESC/)
  assert.match(sql, /LIMIT 21/)
})

test('Gurk provider overlays live signal-cli messages on database history', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'glint-signal-'))
  const configPath = join(directory, 'gurk.toml')
  await writeFile(configPath, 'passphrase = "secret"\n')
  const provider = createGurkProvider({
    env: { GURK_CONFIG: configPath, GURK_DATA_DIR: directory },
    query: async () => [],
  })

  provider.ingestSignalEnvelope({
    sourceUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    sourceName: 'Ada',
    timestamp: 1_700_000_000_000,
    dataMessage: {
      timestamp: 1_700_000_000_000,
      message: 'Live message',
    },
  })
  provider.ingestSignalEnvelope({
    sourceUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    sourceName: 'Ada',
    timestamp: 1_700_000_001_000,
    dataMessage: {
      timestamp: 1_700_000_001_000,
      reaction: {
        targetSentTimestamp: 1_700_000_000_000,
        targetAuthorUuid: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
        emoji: '👍',
        isRemove: false,
      },
    },
  })

  assert.deepEqual(await provider.recentConversations(), {
    items: [{
      id: 'aaaaaaaabbbbccccddddeeeeeeeeeeee',
      title: 'Ada',
      timestamp: 1_700_000_001_000,
      latestMessage: 'Ada reacted 👍',
      reactions: [],
    }],
    nextCursor: null,
    hasMore: false,
  })
  assert.deepEqual(await provider.recentMessages('aaaaaaaabbbbccccddddeeeeeeeeeeee'), {
    items: [{
      id: 'aaaaaaaabbbbccccddddeeeeeeeeeeee:1700000000000',
      conversationId: 'aaaaaaaabbbbccccddddeeeeeeeeeeee',
      sender: 'Ada',
      senderId: 'aaaaaaaabbbbccccddddeeeeeeeeeeee',
      timestamp: 1_700_000_000_000,
      body: 'Live message',
      reactions: [{ senderId: 'aaaaaaaabbbbccccddddeeeeeeeeeeee', emoji: '👍' }],
      isGroup: false,
    }],
    nextCursor: null,
    hasMore: false,
  })
})

test('Gurk provider keyset-pages messages with opaque cursors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'glint-signal-'))
  const configPath = join(directory, 'gurk.toml')
  await writeFile(configPath, 'passphrase = "secret"\n')
  const sqlQueries = []
  const conversationId = '4948758b6d7e44d99caf24db2137eefe'
  const provider = createGurkProvider({
    env: { GURK_CONFIG: configPath, GURK_DATA_DIR: directory },
    limit: 2,
    query: async ({ sql }) => {
      sqlQueries.push(sql)
      return sqlQueries.length === 1
        ? [3, 2, 1].map((timestamp) => ({ conversation_id: conversationId, timestamp, body: `${timestamp}` }))
        : [{ conversation_id: conversationId, timestamp: 1, body: '1' }]
    },
  })

  const first = await provider.recentMessages(conversationId)
  const second = await provider.recentMessages(conversationId, first.nextCursor)

  assert.deepEqual(first.items.map(({ timestamp }) => timestamp), [3, 2])
  assert.equal(first.hasMore, true)
  assert.match(first.nextCursor, /^[A-Za-z0-9_-]+$/)
  assert.deepEqual(second.items.map(({ timestamp }) => timestamp), [1])
  assert.equal(second.hasMore, false)
  assert.match(sqlQueries[0], /LIMIT 3/)
  assert.match(sqlQueries[1], /messages\.arrived_at < 2/)
})

test('Gurk provider keyset-pages tied conversations without repeating live overlays', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'glint-signal-'))
  const configPath = join(directory, 'gurk.toml')
  await writeFile(configPath, 'passphrase = "secret"\n')
  const liveId = 'ffffffffffffffffffffffffffffffff'
  const middleId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  const oldestId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const sqlQueries = []
  const provider = createGurkProvider({
    env: { GURK_CONFIG: configPath, GURK_DATA_DIR: directory },
    limit: 2,
    query: async ({ sql }) => {
      sqlQueries.push(sql)
      return sqlQueries.length === 1
        ? [
            { conversation_id: middleId, title: 'Middle', timestamp: 100, body: 'Middle' },
            { conversation_id: oldestId, title: 'Oldest', timestamp: 100, body: 'Oldest' },
            { conversation_id: '99999999999999999999999999999999', title: 'Later', timestamp: 90, body: 'Later' },
          ]
        : [{ conversation_id: oldestId, title: 'Oldest', timestamp: 100, body: 'Oldest' }]
    },
  })
  provider.ingestSignalEnvelope({
    sourceUuid: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    sourceName: 'Live',
    dataMessage: { timestamp: 200, message: 'Live' },
  })

  const first = await provider.recentConversations()
  const second = await provider.recentConversations(first.nextCursor)

  assert.deepEqual(first.items.map(({ id }) => id), [liveId, middleId])
  assert.equal(first.hasMore, true)
  assert.match(first.nextCursor, /^[A-Za-z0-9_-]+$/)
  assert.deepEqual(second.items.map(({ id }) => id), [oldestId])
  assert.match(sqlQueries[1], new RegExp(`conversation_id < '${middleId}'`))
  assert.match(sqlQueries[1], new RegExp(`conversation_id NOT IN \\('${liveId}'\\)`))
})

test('Gurk provider rejects malformed and cross-conversation cursors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'glint-signal-'))
  const configPath = join(directory, 'gurk.toml')
  await writeFile(configPath, 'passphrase = "secret"\n')
  const firstId = '4948758b6d7e44d99caf24db2137eefe'
  const secondId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const provider = createGurkProvider({
    env: { GURK_CONFIG: configPath, GURK_DATA_DIR: directory },
    limit: 1,
    query: async () => [
      { conversation_id: firstId, timestamp: 2, body: 'New' },
      { conversation_id: firstId, timestamp: 1, body: 'Old' },
    ],
  })

  const first = await provider.recentMessages(firstId)

  await assert.rejects(() => provider.recentMessages(firstId, 'not-a-cursor'), /Invalid pagination cursor/)
  await assert.rejects(() => provider.recentMessages(secondId, first.nextCursor), /Invalid pagination cursor/)
})

test('Gurk provider resolves direct and group reply targets from known channels', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'glint-signal-'))
  const configPath = join(directory, 'gurk.toml')
  await writeFile(configPath, 'passphrase = "secret"\n')
  const directId = '4948758b6d7e44d99caf24db2137eefe'
  const groupId = 'b8825496c61d6bdbdf02f204698ea9aa5cdeda244509f73b07225edd680b06bd'
  const provider = createGurkProvider({
    env: { GURK_CONFIG: configPath, GURK_DATA_DIR: directory },
    query: async ({ sql }) => {
      if (sql.includes(directId)) {
        return [{ conversation_id: directId, name: 'Ada', is_group: 0 }]
      }
      return [{ conversation_id: groupId, name: 'Team', is_group: 1 }]
    },
  })

  assert.deepEqual(await provider.resolveReplyTarget(directId), {
    type: 'direct',
    recipientUuid: '4948758b-6d7e-44d9-9caf-24db2137eefe',
    label: 'Ada',
  })
  assert.deepEqual(await provider.resolveReplyTarget(groupId), {
    type: 'group',
    groupId: Buffer.from(groupId, 'hex').toString('base64'),
    label: 'Team',
  })
  assert.equal(await provider.resolveReplyTarget("' OR 1=1 --"), null)
})
