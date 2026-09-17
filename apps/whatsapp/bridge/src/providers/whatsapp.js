import { BufferJSON, normalizeMessageContent } from '@whiskeysockets/baileys'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { paginateByTimestamp } from '../pagination.js'

const DEFAULT_LIMIT = 20
const STORED_MESSAGES_PER_CHAT = 100

function normalizedJid(value) {
  if (typeof value !== 'string') return null
  const [local, domain] = value.split('@')
  return domain ? `${local.split(':')[0]}@${domain}` : value
}

function publicMessage(message) {
  const { raw, key, ...visible } = message
  return visible
}

function messageTimestamp(message) {
  const timestamp = Number(message?.messageTimestamp)
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp * 1000 : Date.now()
}

function unwrapContent(content) {
  return normalizeMessageContent(content) ?? {}
}

function textFromContent(content) {
  const message = unwrapContent(content)
  return message.conversation
    ?? message.extendedTextMessage?.text
    ?? message.imageMessage?.caption
    ?? message.videoMessage?.caption
    ?? message.documentMessage?.caption
    ?? (message.imageMessage ? 'Photo' : null)
    ?? (message.videoMessage ? 'Video' : null)
    ?? (message.audioMessage ? 'Voice message' : null)
    ?? (message.documentMessage ? `Document${message.documentMessage.fileName ? `: ${message.documentMessage.fileName}` : ''}` : null)
    ?? (message.stickerMessage ? 'Sticker' : null)
    ?? (message.contactMessage || message.contactsArrayMessage ? 'Contact' : null)
    ?? (message.locationMessage || message.liveLocationMessage ? 'Location' : null)
    ?? null
}

function contentContext(content) {
  const message = unwrapContent(content)
  return message.extendedTextMessage?.contextInfo
    ?? message.imageMessage?.contextInfo
    ?? message.videoMessage?.contextInfo
    ?? message.documentMessage?.contextInfo
    ?? message.audioMessage?.contextInfo
    ?? message.stickerMessage?.contextInfo
    ?? null
}

function displayName(jid, contacts) {
  const contact = contacts[jid] ?? {}
  return contact.name ?? contact.notify ?? contact.verifiedName ?? jid?.split('@')[0] ?? 'Unknown'
}

function canonicalKey(key) {
  if (!key?.remoteJid || !key?.id) return null
  return {
    remoteJid: normalizedJid(key.remoteJid),
    id: key.id,
    fromMe: Boolean(key.fromMe),
    ...(key.participant ? { participant: normalizedJid(key.participant) } : {}),
  }
}

export function encodeMessageKey(key) {
  const canonical = canonicalKey(key)
  return canonical ? Buffer.from(JSON.stringify(canonical)).toString('base64url') : null
}

function sameMessageKey(left, right) {
  const a = canonicalKey(left)
  const b = canonicalKey(right)
  return Boolean(a && b
    && a.remoteJid === b.remoteJid
    && a.id === b.id
    && a.fromMe === b.fromMe)
}

function snapshotReplacer(key, value) {
  if (typeof value === 'bigint') return value.toString()
  return BufferJSON.replacer(key, value)
}

export async function createWhatsAppProvider({
  dataPath = process.env.WHATSAPP_STORE ?? './data/whatsapp-store.json',
  limit = DEFAULT_LIMIT,
} = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), 100)
  let state = { version: 1, contacts: {}, chats: {}, messages: {} }
  let savePromise = Promise.resolve()

  try {
    const loaded = JSON.parse(await readFile(dataPath, 'utf8'), BufferJSON.reviver)
    if (loaded?.version === 1) state = loaded
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  function queueSave() {
    savePromise = savePromise.then(async () => {
      await mkdir(dirname(dataPath), { recursive: true })
      const temporaryPath = `${dataPath}.tmp`
      await writeFile(temporaryPath, JSON.stringify(state, snapshotReplacer), { mode: 0o600 })
      await rename(temporaryPath, dataPath)
    }).catch((error) => console.error('Could not persist WhatsApp history:', error))
  }

  function upsertContacts(contacts = []) {
    for (const contact of contacts) {
      const id = normalizedJid(contact.id)
      if (!id) continue
      state.contacts[id] = { ...state.contacts[id], ...contact, id }
    }
  }

  function upsertChats(chats = []) {
    for (const chat of chats) {
      const id = normalizedJid(chat.id)
      if (!id || id === 'status@broadcast' || id.endsWith('@newsletter')) continue
      state.chats[id] = {
        ...state.chats[id],
        id,
        ...(chat.name || chat.subject ? { title: chat.name ?? chat.subject } : {}),
      }
    }
  }

  function reactionActor(message) {
    if (message.key?.fromMe) return 'self'
    return normalizedJid(message.key?.participant ?? message.key?.remoteJid) ?? 'unknown'
  }

  function reactionSender(reaction) {
    if (reaction?.key?.fromMe) return 'self'
    return normalizedJid(reaction?.key?.participant ?? reaction?.key?.remoteJid) ?? 'unknown'
  }

  function applyReaction(targetKey, emoji, senderId) {
    const target = Object.values(state.messages).find((message) => sameMessageKey(message.key, targetKey))
    if (!target) return
    target.reactions = (target.reactions ?? []).filter((reaction) => reaction.senderId !== senderId)
    if (emoji) target.reactions.push({ senderId, emoji })
  }

  function upsertMessage(raw) {
    const key = canonicalKey(raw?.key)
    const conversationId = key?.remoteJid
    if (!key || !conversationId || conversationId === 'status@broadcast' || conversationId.endsWith('@newsletter')) return

    const content = unwrapContent(raw.message)
    if (content.reactionMessage?.key) {
      applyReaction(content.reactionMessage.key, content.reactionMessage.text, reactionActor(raw))
      return
    }

    const body = textFromContent(raw.message)?.trim()
    if (!body) return
    if (raw.pushName && !key.fromMe) {
      const senderJid = normalizedJid(key.participant ?? conversationId)
      state.contacts[senderJid] = { ...state.contacts[senderJid], id: senderJid, notify: raw.pushName }
    }

    const id = encodeMessageKey(key)
    const senderId = key.fromMe ? 'self' : normalizedJid(key.participant ?? conversationId)
    const group = conversationId.endsWith('@g.us')
    const sender = key.fromMe ? 'You' : displayName(senderId, state.contacts)
    const context = contentContext(raw.message)
    const quoteBody = textFromContent(context?.quotedMessage)?.trim()
    const quoteSenderId = normalizedJid(context?.participant)
    const previous = state.messages[id]
    const timestamp = messageTimestamp(raw)

    const historyReactions = (raw.reactions ?? []).flatMap((reaction) => (
      reaction.text ? [{ senderId: reactionSender(reaction), emoji: reaction.text }] : []
    ))
    const reactions = new Map(historyReactions.map((reaction) => [reaction.senderId, reaction.emoji]))
    for (const reaction of previous?.reactions ?? []) reactions.set(reaction.senderId, reaction.emoji)

    state.messages[id] = {
      id,
      conversationId,
      sender,
      senderId,
      timestamp,
      time: new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(timestamp)),
      body,
      reactions: [...reactions].map(([senderId, emoji]) => ({ senderId, emoji })),
      quote: quoteBody ? {
        sender: context?.participant && context.participant === raw.key?.participant
          ? sender
          : displayName(quoteSenderId, state.contacts),
        senderId: quoteSenderId,
        body: quoteBody,
      } : null,
      isGroup: group,
      key,
      raw,
    }

    state.chats[conversationId] = {
      ...state.chats[conversationId],
      id: conversationId,
      title: state.chats[conversationId]?.title ?? displayName(conversationId, state.contacts),
    }
  }

  function pruneMessages() {
    const grouped = new Map()
    for (const message of Object.values(state.messages)) {
      const values = grouped.get(message.conversationId) ?? []
      values.push(message)
      grouped.set(message.conversationId, values)
    }
    for (const messages of grouped.values()) {
      messages.sort((left, right) => right.timestamp - left.timestamp)
      for (const message of messages.slice(STORED_MESSAGES_PER_CHAT)) delete state.messages[message.id]
    }
  }

  function ingest({ chats = [], contacts = [], messages = [] } = {}) {
    upsertContacts(contacts)
    upsertChats(chats)
    for (const message of messages) upsertMessage(message)
    pruneMessages()
    queueSave()
  }

  return {
    name: 'whatsapp',
    ingestHistory: ingest,
    ingestMessages(messages) {
      ingest({ messages })
    },
    ingestReactions(reactions = []) {
      for (const event of reactions) {
        const targetKey = event.key
        const actor = event.reaction?.key?.fromMe
          ? 'self'
          : normalizedJid(event.reaction?.key?.participant ?? event.reaction?.key?.remoteJid) ?? 'unknown'
        applyReaction(targetKey, event.reaction?.text ?? '', actor)
      }
      queueSave()
    },
    ingestMessageUpdates(updates = []) {
      for (const { key, update } of updates) {
        const existing = Object.values(state.messages).find((message) => sameMessageKey(message.key, key))
        if (existing && update?.message) upsertMessage({ ...existing.raw, ...update, key: existing.raw.key })
      }
      queueSave()
    },
    deleteMessages(deletion) {
      if (deletion?.all && deletion.jid) {
        for (const message of Object.values(state.messages)) {
          if (message.conversationId === normalizedJid(deletion.jid)) delete state.messages[message.id]
        }
      } else {
        for (const key of deletion?.keys ?? []) {
          const target = Object.values(state.messages).find((message) => sameMessageKey(message.key, key))
          if (target) delete state.messages[target.id]
        }
      }
      queueSave()
    },
    deleteChats(chatIds = []) {
      for (const rawId of chatIds) {
        const id = normalizedJid(rawId)
        delete state.chats[id]
        for (const message of Object.values(state.messages)) {
          if (message.conversationId === id) delete state.messages[message.id]
        }
      }
      queueSave()
    },
    ingestContacts(contacts) {
      ingest({ contacts })
    },
    ingestChats(chats) {
      ingest({ chats })
    },
    async flush() {
      await savePromise
    },
    async recentConversations(cursor) {
      const latestByChat = new Map()
      for (const message of Object.values(state.messages)) {
        const current = latestByChat.get(message.conversationId)
        if (!current || message.timestamp > current.timestamp) latestByChat.set(message.conversationId, message)
      }
      const conversations = [...latestByChat].map(([id, message]) => ({
        id,
        title: state.chats[id]?.title ?? displayName(id, state.contacts),
        timestamp: message.timestamp,
        time: message.time,
        latestMessage: message.isGroup && message.sender !== 'You' ? `${message.sender}: ${message.body}` : message.body,
        reactions: message.reactions,
      }))
      return paginateByTimestamp(conversations, safeLimit, cursor)
    },
    async recentMessages(conversationId, cursor) {
      if (!state.chats[conversationId]) return null
      const messages = Object.values(state.messages)
        .filter((message) => message.conversationId === conversationId)
        .map(publicMessage)
      return paginateByTimestamp(messages, safeLimit, cursor)
    },
    async resolveReplyTarget(conversationId) {
      const chat = state.chats[conversationId]
      return chat ? { jid: conversationId, label: chat.title ?? displayName(conversationId, state.contacts) } : null
    },
    async resolveMessageTarget(conversationId, messageId) {
      const message = state.messages[messageId]
      return message?.conversationId === conversationId
        ? { id: message.id, key: message.key, raw: message.raw }
        : null
    },
    async findMessageTarget(key) {
      const message = Object.values(state.messages).find((candidate) => sameMessageKey(candidate.key, key))
      return message ? { id: message.id, key: message.key, raw: message.raw } : null
    },
  }
}
