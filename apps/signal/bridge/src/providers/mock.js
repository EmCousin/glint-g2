import { decodeCursor, encodeCursor, InvalidCursorError } from '../pagination.js'

const now = Date.now()
const PAGE_LIMIT = 20

function page(items, cursor, type, conversationId = null) {
  let offset = 0
  if (cursor !== undefined) {
    const payload = decodeCursor(cursor)
    if (payload.type !== type || payload.conversationId !== conversationId || !Number.isInteger(payload.offset) || payload.offset < 0) {
      throw new InvalidCursorError()
    }
    offset = payload.offset
  }
  const pageItems = items.slice(offset, offset + PAGE_LIMIT)
  const nextOffset = offset + pageItems.length
  const hasMore = nextOffset < items.length
  return {
    items: pageItems,
    nextCursor: hasMore ? encodeCursor({ type, conversationId, offset: nextOffset }) : null,
    hasMore,
  }
}

const messages = [
  {
    id: 'mock-1',
    conversationId: 'ada',
    sender: 'Ada',
    senderId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    timestamp: now - 2 * 60_000,
    time: '10:42',
    body: 'The bridge is connected. This message is coming from the mock Signal provider.',
    reactions: [{ senderId: 'bbbbbbbbccccddddeeeeffffffffffff', emoji: '👍' }],
    quote: { senderId: 'aaaaaaaabbbbccccddddeeeeeeeeeeee', sender: 'Ada', body: 'This is an older message in the same conversation.', timestamp: now - 2 * 24 * 60 * 60_000 },
  },
  {
    id: 'mock-2',
    conversationId: 'grace',
    sender: 'Grace',
    senderId: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
    timestamp: now - 45 * 60_000,
    time: '09:18',
    body: 'Swipe down to see the next message and press to expand the current preview.',
    reactions: [],
  },
  {
    id: 'mock-3',
    conversationId: 'team',
    sender: 'Glint team',
    senderId: 'cccccccc-dddd-eeee-ffff-aaaaaaaaaaaa',
    timestamp: now - 26 * 60 * 60_000,
    time: 'Yesterday',
    body: 'Gurk integration comes next. The bridge provider boundary keeps Signal session details off the glasses.',
    reactions: [],
  },
  {
    id: 'mock-4',
    conversationId: 'ada',
    sender: 'Ada',
    senderId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    timestamp: now - 2 * 24 * 60 * 60_000,
    time: 'Yesterday',
    body: 'This is an older message in the same conversation.',
    reactions: [],
  },
]

const conversations = [
  { id: 'ada', title: 'Ada', timestamp: messages[0].timestamp, time: '10:42', latestMessage: messages[0].body },
  { id: 'grace', title: 'Grace', timestamp: messages[1].timestamp, time: '09:18', latestMessage: messages[1].body },
  { id: 'team', title: 'Glint team', timestamp: messages[2].timestamp, time: 'Yesterday', latestMessage: messages[2].body },
]

export const mockProvider = {
  name: 'mock',
  async recentConversations(cursor) {
    return page(conversations, cursor, 'mock-conversations')
  },
  async recentMessages(conversationId, cursor) {
    return conversations.some(({ id }) => id === conversationId)
      ? page(
        messages.filter((message) => message.conversationId === conversationId),
        cursor,
        'mock-messages',
        conversationId,
      )
      : null
  },
  async resolveReplyTarget(conversationId) {
    const message = messages.find((candidate) => candidate.conversationId === conversationId)
    return message ? { type: 'mock', conversationId, label: message.sender } : null
  },
  async resolveMessageTarget(conversationId, messageId) {
    const message = messages.find((candidate) => (
      candidate.conversationId === conversationId && candidate.id === messageId
    ))
    return message ? {
      timestamp: message.timestamp,
      senderUuid: message.senderId,
      body: message.body,
    } : null
  },
}
