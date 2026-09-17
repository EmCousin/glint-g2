import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'smol-toml'
import { decodeCursor, encodeCursor, InvalidCursorError } from '../pagination.js'

const DEFAULT_LIMIT = 20

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`
}

function normalizedUuid(value) {
  return typeof value === 'string' ? value.replaceAll('-', '').toLowerCase() : null
}

function signalConversationId(message, directUuid) {
  if (message?.groupInfo?.groupId) {
    return Buffer.from(message.groupInfo.groupId, 'base64').toString('hex')
  }
  return normalizedUuid(directUuid)
}

function conversationCursor(cursor) {
  if (cursor === undefined) return null
  const payload = decodeCursor(cursor)
  if (
    payload.type !== 'gurk-conversations'
    || !Number.isSafeInteger(payload.timestamp)
    || !/^(?:[0-9a-f]{32}|[0-9a-f]{64})$/.test(payload.id)
    || !Array.isArray(payload.liveIds)
    || payload.liveIds.some((id) => !/^(?:[0-9a-f]{32}|[0-9a-f]{64})$/.test(id))
  ) throw new InvalidCursorError()
  return payload
}

function messageCursor(cursor, conversationId) {
  if (cursor === undefined) return null
  const payload = decodeCursor(cursor)
  if (
    payload.type !== 'gurk-messages'
    || payload.conversationId !== conversationId
    || !Number.isSafeInteger(payload.timestamp)
  ) throw new InvalidCursorError()
  return payload
}

function isBeforeConversationCursor(conversation, cursor) {
  return !cursor
    || conversation.timestamp < cursor.timestamp
    || (conversation.timestamp === cursor.timestamp && conversation.id < cursor.id)
}

export function runSqlCipher({ executable, databasePath, passphrase, sql }) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-readonly', '-json', databasePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`SQLCipher exited with code ${code}: ${stderr.trim()}`))
        return
      }

      const resultStart = stdout.indexOf('\n[')
      if (resultStart === -1) {
        reject(new Error('SQLCipher returned an unexpected response'))
        return
      }

      try {
        resolve(JSON.parse(stdout.slice(resultStart + 1)))
      } catch (error) {
        reject(new Error('SQLCipher returned invalid JSON', { cause: error }))
      }
    })

    child.stdin.end(`PRAGMA key = ${sqlString(passphrase)}; PRAGMA query_only = ON; ${sql}\n`)
  })
}

export function decodeGurkReactions(hex) {
  if (!hex) return []
  const data = Buffer.from(hex, 'hex')
  let offset = 0
  const count = data[offset++] ?? 0
  const reactions = []

  for (let index = 0; index < count; index += 1) {
    const uuidLength = data[offset++]
    if (uuidLength !== 16 || offset + uuidLength > data.length) return []
    const senderId = data.subarray(offset, offset + uuidLength).toString('hex')
    offset += uuidLength
    const emojiLength = data[offset++]
    if (!emojiLength || offset + emojiLength > data.length) return []
    reactions.push({ senderId, emoji: data.subarray(offset, offset + emojiLength).toString('utf8') })
    offset += emojiLength
  }

  return reactions
}

export function mapGurkMessage(row) {
  const timestamp = Number(row.timestamp)
  const quoteTimestamp = row.quote_timestamp == null ? null : Number(row.quote_timestamp)
  return {
    id: `${row.conversation_id}:${timestamp}`,
    conversationId: row.conversation_id,
    sender: row.sender || 'Unknown',
    senderId: row.sender_id || null,
    timestamp,
    time: new Intl.DateTimeFormat(undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(timestamp)),
    body: row.body,
    reactions: decodeGurkReactions(row.reactions_hex),
    quote: quoteTimestamp
      ? { timestamp: quoteTimestamp, sender: row.quote_sender || 'Unknown', body: row.quote_body ?? '' }
      : null,
  }
}

export function mapGurkConversation(row) {
  const timestamp = Number(row.timestamp)
  return {
    id: row.conversation_id,
    title: row.title || 'Unknown',
    timestamp,
    time: new Intl.DateTimeFormat(undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(timestamp)),
    latestMessage: row.is_group && row.sender
      ? `${row.sender}: ${row.body}`
      : row.body,
    reactions: decodeGurkReactions(row.reactions_hex),
  }
}

export function createGurkProvider({
  env = process.env,
  home = homedir(),
  query = runSqlCipher,
  limit = DEFAULT_LIMIT,
} = {}) {
  const configPath = env.GURK_CONFIG ?? join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'gurk', 'gurk.toml')
  const dataDirectory = env.GURK_DATA_DIR ?? join(env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'gurk')
  const databasePath = join(dataDirectory, 'gurk.sqlite')
  const executable = env.SQLCIPHER_PATH ?? 'sqlcipher'
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), 100)
  const liveMessages = new Map()
  const liveReactions = new Map()
  const liveTitles = new Map()
  const liveConversationEvents = new Map()
  const ownSenderIds = new Set()

  async function queryDatabase(sql) {
    const config = parse(await readFile(configPath, 'utf8'))
    const passphrase = env.GURK_PASSPHRASE ?? config.passphrase
    if (typeof passphrase !== 'string' || passphrase.length === 0) {
      throw new Error('Gurk passphrase not found; set GURK_PASSPHRASE or configure Gurk passphrase')
    }

    return query({ executable, databasePath, passphrase, sql })
  }

  return {
    name: 'gurk',
    async recentConversations(cursorValue) {
      const cursor = conversationCursor(cursorValue)
      const excludedLiveIds = new Set(cursor?.liveIds ?? [])
      const liveConversationIds = new Set(
        [...liveMessages.values()].map(({ conversationId }) => conversationId),
      )
      const cursorFilter = cursor
        ? `AND (timestamp < ${cursor.timestamp} OR (timestamp = ${cursor.timestamp} AND conversation_id < ${sqlString(cursor.id)}))`
        : ''
      const liveFilter = excludedLiveIds.size > 0
        ? `AND conversation_id NOT IN (${[...excludedLiveIds].map(sqlString).join(', ')})`
        : ''
      const rows = await queryDatabase(`
        WITH ranked_messages AS (
          SELECT
            lower(hex(messages.channel_id)) AS conversation_id,
            channels.name AS title,
            messages.arrived_at AS timestamp,
            coalesce(names.name, channels.name, 'Unknown') AS sender,
            messages.message AS body,
            hex(messages.reactions) AS reactions_hex,
            channels.group_master_key IS NOT NULL AS is_group,
            row_number() OVER (
              PARTITION BY messages.channel_id
              ORDER BY messages.arrived_at DESC
            ) AS position
          FROM messages
          JOIN channels ON channels.id = messages.channel_id
          LEFT JOIN names ON names.id = messages.from_id
          WHERE messages.deleted = 0
            AND messages.message IS NOT NULL
            AND trim(messages.message) != ''
            AND (messages.expires_at IS NULL OR messages.expires_at > ${Date.now()})
        )
        SELECT conversation_id, title, timestamp, sender, body, reactions_hex, is_group
        FROM ranked_messages
        WHERE position = 1
          ${cursorFilter}
          ${liveFilter}
        ORDER BY timestamp DESC, conversation_id DESC
        LIMIT ${safeLimit + 1};
        `)

      const conversations = rows.map(mapGurkConversation)
      for (const message of liveMessages.values()) {
        if (cursor?.liveIds.includes(message.conversationId)) continue
        const conversation = conversations.find(({ id }) => id === message.conversationId)
        const latestMessage = message.isGroup && message.sender !== 'You'
          ? `${message.sender}: ${message.body}`
          : message.body
        if (!conversation) {
          conversations.push({
            id: message.conversationId,
            title: liveTitles.get(message.conversationId) ?? message.sender,
            timestamp: message.timestamp,
            latestMessage,
            reactions: message.reactions,
          })
        } else if (message.timestamp > conversation.timestamp) {
          conversation.timestamp = message.timestamp
          conversation.latestMessage = latestMessage
          conversation.reactions = message.reactions
        }
      }
      for (const [conversationId, event] of liveConversationEvents) {
        const conversation = conversations.find(({ id }) => id === conversationId)
        if (conversation && event.timestamp > conversation.timestamp) {
          conversation.timestamp = event.timestamp
          conversation.latestMessage = event.latestMessage
          conversation.reactions = []
        }
      }
      const combined = conversations
        .map((conversation) => {
          const overrides = liveReactions.get(`${conversation.id}:${conversation.timestamp}`)
          if (!overrides) return conversation
          return {
            ...conversation,
            reactions: [
              ...(conversation.reactions ?? []).filter(({ senderId }) => !overrides.has(senderId)),
              ...[...overrides].flatMap(([senderId, emoji]) => emoji ? [{ senderId, emoji }] : []),
            ],
          }
        })
        .filter((conversation) => isBeforeConversationCursor(conversation, cursor))
        .sort((left, right) => right.timestamp - left.timestamp || right.id.localeCompare(left.id))
      const items = combined.slice(0, safeLimit)
      const hasMore = combined.length > safeLimit
      const nextLiveIds = new Set(cursor?.liveIds ?? [])
      for (const item of items) {
        if (liveConversationIds.has(item.id) || liveConversationEvents.has(item.id)) {
          nextLiveIds.add(item.id)
        }
      }
      const last = items.at(-1)
      return {
        items,
        nextCursor: hasMore && last ? encodeCursor({
          type: 'gurk-conversations',
          timestamp: last.timestamp,
          id: last.id,
          liveIds: [...nextLiveIds],
        }) : null,
        hasMore,
      }
    },
    async recentMessages(conversationId, cursorValue) {
      if (!/^(?:[0-9a-f]{32}|[0-9a-f]{64})$/.test(conversationId)) return null
      const cursor = messageCursor(cursorValue, conversationId)
      const cursorFilter = cursor ? `AND messages.arrived_at < ${cursor.timestamp}` : ''

      const rows = await queryDatabase(`
        SELECT
          lower(hex(messages.channel_id)) AS conversation_id,
          lower(hex(messages.from_id)) AS sender_id,
          messages.arrived_at AS timestamp,
          coalesce(names.name, channels.name, 'Unknown') AS sender,
          messages.message AS body,
          hex(messages.reactions) AS reactions_hex,
          messages.quote AS quote_timestamp,
          coalesce(quoted_names.name, channels.name, 'Unknown') AS quote_sender,
          quoted.message AS quote_body
        FROM messages
        JOIN channels ON channels.id = messages.channel_id
        LEFT JOIN names ON names.id = messages.from_id
        LEFT JOIN messages AS quoted ON quoted.channel_id = messages.channel_id AND quoted.arrived_at = messages.quote
        LEFT JOIN names AS quoted_names ON quoted_names.id = quoted.from_id
        WHERE lower(hex(messages.channel_id)) = ${sqlString(conversationId)}
          AND messages.deleted = 0
          AND messages.message IS NOT NULL
          AND trim(messages.message) != ''
          AND (messages.expires_at IS NULL OR messages.expires_at > ${Date.now()})
          ${cursorFilter}
        ORDER BY messages.arrived_at DESC
        LIMIT ${safeLimit + 1};
      `)

      const databaseMessages = rows.map(mapGurkMessage)
      const combined = new Map(databaseMessages.map((message) => [message.id, message]))
      for (const message of liveMessages.values()) {
        if (
          message.conversationId === conversationId
          && (!cursor || message.timestamp < cursor.timestamp)
        ) combined.set(message.id, message)
      }
      const pageMessages = [...combined.values()]
        .map((message) => {
          const overrides = liveReactions.get(message.id)
          if (!overrides) return message
          return {
            ...message,
            reactions: [
              ...(message.reactions ?? []).filter(({ senderId }) => !overrides.has(senderId)),
              ...[...overrides].flatMap(([senderId, emoji]) => emoji ? [{ senderId, emoji }] : []),
            ],
          }
        })
        .sort((left, right) => right.timestamp - left.timestamp)
      const items = pageMessages.slice(0, safeLimit)
      const hasMore = pageMessages.length > safeLimit
      const last = items.at(-1)
      return {
        items,
        nextCursor: hasMore && last ? encodeCursor({
          type: 'gurk-messages',
          conversationId,
          timestamp: last.timestamp,
        }) : null,
        hasMore,
      }
    },
    async resolveMessageTarget(conversationId, messageId) {
      if (!/^(?:[0-9a-f]{32}|[0-9a-f]{64})$/.test(conversationId)) return null
      const prefix = `${conversationId}:`
      if (!messageId.startsWith(prefix)) return null
      const timestamp = Number(messageId.slice(prefix.length))
      if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return null

      const [message] = await queryDatabase(`
        SELECT
          messages.arrived_at AS timestamp,
          lower(hex(messages.from_id)) AS sender_id,
          messages.message AS body
        FROM messages
        WHERE lower(hex(messages.channel_id)) = ${sqlString(conversationId)}
          AND messages.arrived_at = ${timestamp}
          AND messages.deleted = 0
        LIMIT 1;
      `)
      if (!message?.sender_id) return null

      const senderId = message.sender_id
      return {
        timestamp: Number(message.timestamp),
        senderUuid: `${senderId.slice(0, 8)}-${senderId.slice(8, 12)}-${senderId.slice(12, 16)}-${senderId.slice(16, 20)}-${senderId.slice(20)}`,
        body: message.body || '',
      }
    },
    async resolveReplyTarget(conversationId) {
      if (!/^(?:[0-9a-f]{32}|[0-9a-f]{64})$/.test(conversationId)) return null

      const [channel] = await queryDatabase(`
        SELECT
          lower(hex(id)) AS conversation_id,
          name,
          group_master_key IS NOT NULL AS is_group
        FROM channels
        WHERE lower(hex(id)) = ${sqlString(conversationId)}
        LIMIT 1;
      `)
      if (!channel) return null

      if (channel.is_group) {
        return {
          type: 'group',
          groupId: Buffer.from(channel.conversation_id, 'hex').toString('base64'),
          label: channel.name,
        }
      }

      const uuid = channel.conversation_id
      return {
        type: 'direct',
        recipientUuid: `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`,
        label: channel.name,
      }
    },
    ingestSignalEnvelope(envelope) {
      const sentMessage = envelope?.syncMessage?.sentMessage
      const dataMessage = envelope?.dataMessage ?? sentMessage
      if (!dataMessage) return

      const outgoing = Boolean(sentMessage)
      const envelopeSenderId = normalizedUuid(envelope.sourceUuid)
      if (outgoing && envelopeSenderId) ownSenderIds.add(envelopeSenderId)
      const directUuid = outgoing ? sentMessage.destinationUuid : envelope.sourceUuid
      const conversationId = signalConversationId(dataMessage, directUuid)
      if (!conversationId) return
      if (!dataMessage.groupInfo?.groupId && !outgoing && envelope.sourceName) {
        liveTitles.set(conversationId, envelope.sourceName)
      }

      const reaction = dataMessage.reaction
      if (reaction?.targetSentTimestamp && reaction.emoji) {
        const messageId = `${conversationId}:${Number(reaction.targetSentTimestamp)}`
        const reactions = liveReactions.get(messageId) ?? new Map()
        const senderId = normalizedUuid(envelope.sourceUuid) ?? 'self'
        reactions.set(senderId, reaction.isRemove ? null : reaction.emoji)
        liveReactions.set(messageId, reactions)
        const targetAuthorId = normalizedUuid(reaction.targetAuthorUuid)
        const targetsOwnDirectMessage = !dataMessage.groupInfo?.groupId
          && targetAuthorId
          && targetAuthorId !== envelopeSenderId
        const targetsOwnGroupMessage = targetAuthorId && ownSenderIds.has(targetAuthorId)
        const timestamp = Number(dataMessage.timestamp ?? envelope.timestamp)
        if (!outgoing && !reaction.isRemove && Number.isSafeInteger(timestamp) && (
          targetsOwnDirectMessage || targetsOwnGroupMessage
        )) {
          const sender = envelope.sourceName || envelope.sourceNumber || 'Someone'
          const current = liveConversationEvents.get(conversationId)
          if (!current || timestamp > current.timestamp) {
            liveConversationEvents.set(conversationId, {
              timestamp,
              latestMessage: `${sender} reacted ${reaction.emoji}`,
            })
          }
        }
        return
      }

      const body = dataMessage.message?.trim()
      const timestamp = Number(dataMessage.timestamp ?? envelope.timestamp)
      if (!body || !Number.isSafeInteger(timestamp)) return
      const id = `${conversationId}:${timestamp}`
      liveMessages.set(id, {
        id,
        conversationId,
        sender: outgoing ? 'You' : (envelope.sourceName || envelope.sourceNumber || 'Unknown'),
        senderId: normalizedUuid(envelope.sourceUuid),
        timestamp,
        body,
        reactions: [],
        isGroup: Boolean(dataMessage.groupInfo?.groupId),
      })
      while (liveMessages.size > 100) liveMessages.delete(liveMessages.keys().next().value)
    },
  }
}
