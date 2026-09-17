const now = Date.now()

const messages = [
  {
    id: 'mock-1',
    conversationId: 'ada',
    sender: 'Ada',
    senderId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    timestamp: now - 2 * 60_000,
    time: '10:42',
    body: 'The bridge is connected. This email is coming from the mock HEY provider.',
    reactions: [],
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
    body: 'HEY CLI integration keeps account credentials on the workstation.',
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
  async recentConversations() {
    return { items: conversations, nextCursor: null, hasMore: false }
  },
  async recentMessages(conversationId) {
    return conversations.some(({ id }) => id === conversationId)
      ? { items: messages.filter((message) => message.conversationId === conversationId), nextCursor: null, hasMore: false }
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
