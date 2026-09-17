import { paginateByTimestamp } from '../pagination.js'

const now = Date.now()
const LIMIT = 20

const messages = [
  {
    id: 'mock-1',
    conversationId: 'ada',
    sender: 'Ada',
    senderId: 'ada@c.us',
    timestamp: now - 2 * 60_000,
    time: '10:42',
    body: 'The bridge is connected. This message is coming from the mock WhatsApp provider.',
    reactions: [{ senderId: 'grace@c.us', emoji: '👍' }],
    quote: { senderId: 'ada@c.us', sender: 'Ada', body: 'This is an older message in the same conversation.', timestamp: now - 2 * 24 * 60 * 60_000 },
  },
  {
    id: 'mock-2',
    conversationId: 'grace',
    sender: 'Grace',
    senderId: 'grace@c.us',
    timestamp: now - 45 * 60_000,
    time: '09:18',
    body: 'Swipe down to see the next message and press to expand the current preview.',
    reactions: [],
  },
  {
    id: 'mock-3',
    conversationId: 'team',
    sender: 'Glint team',
    senderId: 'team@g.us',
    timestamp: now - 26 * 60 * 60_000,
    time: 'Yesterday',
    body: 'The provider boundary keeps WhatsApp session details off the glasses.',
    reactions: [],
  },
  {
    id: 'mock-4',
    conversationId: 'ada',
    sender: 'Ada',
    senderId: 'ada@c.us',
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
    return paginateByTimestamp(conversations, LIMIT, cursor)
  },
  async recentMessages(conversationId, cursor) {
    return conversations.some(({ id }) => id === conversationId)
      ? paginateByTimestamp(
          messages.filter((message) => message.conversationId === conversationId),
          LIMIT,
          cursor,
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
    return message ? { id: message.id, key: { remoteJid: conversationId, id: message.id }, raw: message } : null
  },
}
