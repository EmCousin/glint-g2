import cors from 'cors'
import crypto from 'node:crypto'
import express from 'express'

const DRAFT_TTL_MS = 60_000
const REACTION_EMOJIS = ['👍', '❤️', '😂']

function bearerToken(request) {
  const authorization = request.get('authorization')
  return authorization?.startsWith('Bearer ') ? authorization.slice(7) : null
}

function isInvalidCursor(error) {
  return error?.code === 'INVALID_CURSOR' || error?.name === 'InvalidCursorError'
}

export function createBridgeApp({
  token,
  provider,
  sender,
  transcriber,
  capabilities,
  now = Date.now,
  createId = crypto.randomUUID,
}) {
  if (!token) throw new Error('BRIDGE_TOKEN is required')
  if (!sender) throw new Error('sender is required')
  if (!transcriber) throw new Error('transcriber is required')

  const {
    quotedReplies = false,
    reactions = false,
    sentMessageIds = false,
  } = capabilities ?? {}
  const app = express()
  const drafts = new Map()

  app.disable('x-powered-by')
  app.use((request, response, next) => {
    const startedAt = Date.now()
    response.on('finish', () => {
      console.log(`[req] ${request.method} ${request.url} -> ${response.statusCode} (${Date.now() - startedAt}ms)`)
    })
    next()
  })
  app.use(cors())
  app.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store')
    next()
  })
  app.use(express.raw({ type: 'application/octet-stream', limit: '4mb' }))
  app.use(express.json({ limit: '16kb' }))

  async function createDraft(conversationId, message, messageId = null) {
    const target = await provider.resolveReplyTarget(conversationId)
    if (!target) return null

    const quote = quotedReplies && messageId
      ? await provider.resolveMessageTarget(conversationId, messageId)
      : null
    if (quotedReplies && messageId && !quote) return null

    for (const [id, draft] of drafts) {
      if (draft.expiresAt <= now()) drafts.delete(id)
    }
    const draftId = createId()
    const expiresAt = now() + DRAFT_TTL_MS
    drafts.set(draftId, { target, message, quote, expiresAt })
    return { draftId, recipient: target.label, message, expiresAt }
  }

  app.get('/health', (_request, response) => {
    const connection = sender.status?.()
    const detail = sender.statusDetail?.()
    response.json({
      status: connection && connection !== 'open' ? connection : 'ok',
      provider: provider.name,
      ...(connection ? { connection } : {}),
      ...(detail ? { detail } : {}),
    })
  })

  app.use('/api', (request, response, next) => {
    if (bearerToken(request) !== token) {
      response.status(401).json({ error: 'unauthorized' })
      return
    }
    next()
  })

  // Diagnostic endpoint for devices where copying multi-line logs is impractical.
  app.post('/api/debug-log', (request, response) => {
    console.log('[debug]', request.body?.message ?? request.body)
    response.json({ ok: true })
  })

  app.get('/api/conversations', async (request, response, next) => {
    try {
      const cursor = request.query.cursor
      if (cursor !== undefined && typeof cursor !== 'string') {
        response.status(400).json({ error: 'invalid_cursor' })
        return
      }
      const page = await provider.recentConversations(cursor)
      response.json({ conversations: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/conversations/:conversationId/messages', async (request, response, next) => {
    try {
      const cursor = request.query.cursor
      if (cursor !== undefined && typeof cursor !== 'string') {
        response.status(400).json({ error: 'invalid_cursor' })
        return
      }
      const page = await provider.recentMessages(request.params.conversationId, cursor)
      if (!page) {
        response.status(404).json({ error: 'conversation_not_found' })
        return
      }
      response.json({ messages: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/replies/drafts', async (request, response, next) => {
    try {
      const { conversationId, message, messageId } = request.body ?? {}
      if (
        typeof conversationId !== 'string'
        || typeof message !== 'string'
        || (quotedReplies && messageId != null && typeof messageId !== 'string')
      ) {
        response.status(400).json({ error: 'invalid_draft' })
        return
      }

      const text = message.trim()
      if (text.length === 0 || text.length > 4000) {
        response.status(400).json({ error: 'invalid_draft' })
        return
      }

      const draft = await createDraft(conversationId, text, messageId)
      if (!draft) {
        response.status(404).json({ error: 'conversation_not_found' })
        return
      }
      response.status(201).json(draft)
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/replies/dictate', async (request, response, next) => {
    try {
      const conversationId = request.get('x-conversation-id')
      const messageId = quotedReplies ? request.get('x-message-id') : null
      if (typeof conversationId !== 'string' || !Buffer.isBuffer(request.body) || request.body.length === 0) {
        response.status(400).json({ error: 'invalid_audio' })
        return
      }

      const text = (await transcriber.transcribe(request.body)).trim()
      if (text.length === 0 || text.length > 4000) {
        response.status(422).json({ error: 'no_speech' })
        return
      }

      const draft = await createDraft(conversationId, text, messageId)
      if (!draft) {
        response.status(404).json({ error: 'conversation_not_found' })
        return
      }
      response.status(201).json(draft)
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/replies/dictate/preview', async (request, response, next) => {
    try {
      if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
        response.status(400).json({ error: 'invalid_audio' })
        return
      }
      response.json({ text: (await transcriber.transcribe(request.body)).trim() })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/replies/:draftId/confirm', async (request, response, next) => {
    try {
      if (request.body?.confirm !== true) {
        response.status(400).json({ error: 'confirmation_required' })
        return
      }

      const draft = drafts.get(request.params.draftId)
      drafts.delete(request.params.draftId)
      if (!draft || draft.expiresAt <= now()) {
        response.status(404).json({ error: 'draft_not_found' })
        return
      }

      const result = quotedReplies
        ? await sender.send(draft.target, draft.message, draft.quote)
        : await sender.send(draft.target, draft.message)
      const timestamp = Number(result?.timestamp) || now()
      response.json({
        status: 'sent',
        message: {
          id: sentMessageIds && result?.id ? result.id : `sent:${timestamp}`,
          sender: 'You',
          timestamp,
          body: draft.message,
          reactions: [],
        },
      })
    } catch (error) {
      next(error)
    }
  })

  if (reactions) {
    app.post('/api/reactions', async (request, response, next) => {
      try {
        const { conversationId, messageId, emoji, remove = false } = request.body ?? {}
        if (
          typeof conversationId !== 'string'
          || typeof messageId !== 'string'
          || !REACTION_EMOJIS.includes(emoji)
          || typeof remove !== 'boolean'
        ) {
          response.status(400).json({ error: 'invalid_reaction' })
          return
        }

        const [target, message] = await Promise.all([
          provider.resolveReplyTarget(conversationId),
          provider.resolveMessageTarget(conversationId, messageId),
        ])
        if (!target || !message) {
          response.status(404).json({ error: 'message_not_found' })
          return
        }

        await sender.react(target, message, emoji, remove)
        response.json({ status: remove ? 'removed' : 'sent' })
      } catch (error) {
        next(error)
      }
    })
  }

  app.use((error, _request, response, _next) => {
    if (isInvalidCursor(error)) {
      response.status(400).json({ error: 'invalid_cursor' })
      return
    }
    console.error(error)
    response.status(500).json({ error: 'internal_error' })
  })

  return app
}
