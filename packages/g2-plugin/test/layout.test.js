import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_TEXT_CONTAINERS,
  conversationCardContainers,
  messageCardContainers,
  messageReaderContainers,
  placeholderContainers,
  readerPageInfo,
  reactionsMenuContainers,
  statusContainer,
  visibleWindow,
} from '../src/layout.js'

const measureText = (value) => [...value].length * 12

function plainMessage(overrides = {}) {
  return { sender: 'Ada', body: 'Hello', timestamp: 1, reactions: [], quote: null, ...overrides }
}

function replyMessage(overrides = {}) {
  return {
    sender: 'Ada',
    body: 'Sounds good',
    timestamp: 2,
    reactions: [],
    quote: { sender: 'Grace', body: 'Are we still on for lunch?', timestamp: 1 },
    ...overrides,
  }
}

test('visibleWindow centers the selection and clamps to the array bounds', () => {
  const items = [0, 1, 2, 3, 4]
  assert.deepEqual(visibleWindow(items, 0, 2), { start: 0, items: [0, 1] })
  assert.deepEqual(visibleWindow(items, 4, 2), { start: 3, items: [3, 4] })
  assert.deepEqual(visibleWindow(items, 2, 2), { start: 1, items: [1, 2] })
})

test('placeholderContainers reserves invisible containers with distinct, offset IDs', () => {
  const placeholders = placeholderContainers(3, 90)

  assert.equal(placeholders.length, 3)
  assert.deepEqual(placeholders.map((p) => p.containerID), [90, 91, 92])
  assert.ok(placeholders.every((p) => p.content === '' && p.width === 1 && p.height === 1))
})

test('statusContainer fills the whole screen with the given content', () => {
  const container = statusContainer('hello')
  assert.equal(container.content, 'hello')
  assert.equal(container.width, 576)
  assert.equal(container.height, 288)
})

test('conversationCardContainers renders title, body, and metadata containers per card, plus a scrollbar once there are more conversations than fit', () => {
  const conversations = [1, 2, 3].map((n) => ({ title: `Chat ${n}`, latestMessage: 'Hi', timestamp: n }))
  const withoutScrollbar = conversationCardContainers({ conversations: conversations.slice(0, 2), selectedIndex: 0, measureText })
  const withScrollbar = conversationCardContainers({ conversations, selectedIndex: 0, measureText })

  assert.equal(withoutScrollbar.length, 6) // 2 conversations x 3 containers each
  assert.equal(withScrollbar.length, 7) // + scrollbar
  assert.ok(withScrollbar.length <= MAX_TEXT_CONTAINERS)
  assert.ok(withoutScrollbar.every((c) => c.containerName.length <= 15))

  const title = withoutScrollbar.find((c) => c.containerName === 'conv-0')
  assert.equal(title.content, 'Chat 1')
  const metadata = withoutScrollbar.find((c) => c.containerName === 'conv-0-md')
  assert.ok(metadata)
  const body = withoutScrollbar.find((c) => c.containerName === 'conv-0-b')
  assert.equal(body.content, 'Hi')
})

test('messageCardContainers shows two plain messages plus composer and scrollbar within the container budget', () => {
  const messages = [plainMessage({ timestamp: 1 }), plainMessage({ timestamp: 2 }), plainMessage({ timestamp: 3 })]
  const cards = messageCardContainers({
    messages,
    selectedIndex: 2,
    replyMode: false,
    messageSelected: false,
    composerText: '/ Hold to reply',
    measureText,
  })

  // 2 visible plain messages (3 containers each) + composer + scrollbar
  assert.equal(cards.length, 8)
  assert.ok(cards.length <= MAX_TEXT_CONTAINERS)
})

test('messageCardContainers falls back to a single visible message when two replies would exceed the budget', () => {
  const messages = [replyMessage({ timestamp: 1 }), replyMessage({ timestamp: 2 })]
  const cards = messageCardContainers({
    messages,
    selectedIndex: 1,
    replyMode: false,
    messageSelected: false,
    composerText: '/ Hold to reply',
    measureText,
  })

  // Two reply cards (4 containers each) + composer would be 9, over the
  // budget - falls back to just the selected message.
  const replyCard = cards.find((card) => card.containerName === 'msg-1')
  assert.ok(replyCard)
  assert.equal(cards.filter((c) => c.containerName.startsWith('msg-')).length, 4)
  const quote = cards.find((c) => c.containerName === 'msg-1-q')
  assert.match(quote.content, /^> /m)
  const body = cards.find((c) => c.containerName === 'msg-1-b')
  assert.match(body.content, /Sounds good/)
  assert.ok(cards.length <= MAX_TEXT_CONTAINERS)
})

test('messageCardContainers keeps both cards when only one of the two is a reply', () => {
  const messages = [plainMessage({ timestamp: 1 }), replyMessage({ timestamp: 2 })]
  const cards = messageCardContainers({
    messages,
    selectedIndex: 1,
    replyMode: false,
    messageSelected: false,
    composerText: '/ Hold to reply',
    measureText,
  })

  const titleCards = cards.filter((card) => /^msg-\d+$/.test(card.containerName))
  assert.equal(titleCards.length, 2)
  assert.ok(cards.length <= MAX_TEXT_CONTAINERS)
})

test('messageCardContainers grows the composer to fit its content while dictating', () => {
  const messages = [plainMessage()]
  const idle = messageCardContainers({
    messages,
    selectedIndex: 0,
    replyMode: false,
    messageSelected: false,
    composerText: '/ Hold to reply',
    measureText,
  })
  const dictating = messageCardContainers({
    messages,
    selectedIndex: 0,
    replyMode: true,
    messageSelected: false,
    composerText: '/ This is a much longer transcript that needs to wrap across several lines',
    measureText,
  })

  const composerHeight = (cards) => cards.find((card) => card.containerName === 'reply-composer').height
  assert.ok(composerHeight(dictating) > composerHeight(idle))
})

test('message reader pages through the complete body without truncation', () => {
  const message = plainMessage({ body: Array.from({ length: 80 }, (_, index) => `word${index}`).join(' ') })
  const firstPage = readerPageInfo(message, 0, measureText)
  const lastPage = readerPageInfo(message, Number.MAX_SAFE_INTEGER, measureText)
  const firstCards = messageReaderContainers({ message, lineOffset: 0, measureText })
  const lastCards = messageReaderContainers({ message, lineOffset: lastPage.offset, measureText })
  const firstBody = firstCards.find((card) => card.containerName === 'reader-body')
  const lastBody = lastCards.find((card) => card.containerName === 'reader-body')
  const firstScrollbar = firstCards.find((card) => card.containerName === 'reader-scroll')
  const lastScrollbar = lastCards.find((card) => card.containerName === 'reader-scroll')

  assert.ok(firstPage.maxOffset > 0)
  assert.equal(lastPage.offset, firstPage.maxOffset)
  assert.notEqual(firstBody.content, lastBody.content)
  assert.doesNotMatch(firstBody.content, /\.\.\./)
  assert.doesNotMatch(lastBody.content, /\.\.\./)
  assert.match(lastBody.content, /word79/)
  assert.equal(firstScrollbar.yPosition, firstBody.yPosition)
  assert.equal(lastScrollbar.yPosition + lastScrollbar.height, firstBody.yPosition + firstPage.visibleLines * 24)
  assert.ok(lastCards.every((card) => card.yPosition + card.height <= 288))
  assert.ok(lastCards.length <= MAX_TEXT_CONTAINERS)
  assert.ok(!lastCards.some((card) => card.containerName === 'reply-composer'))
})

test('quoted message reader keeps context and body inside the display', () => {
  const message = replyMessage({ body: 'body '.repeat(100) })
  const cards = messageReaderContainers({ message, lineOffset: 0, measureText })

  assert.ok(cards.some((card) => card.containerName === 'reader-quote'))
  assert.ok(cards.every((card) => card.yPosition + card.height <= 288))
  assert.ok(cards.length <= MAX_TEXT_CONTAINERS)
})

test('message cards can suppress reactions for providers without reaction support', () => {
  const cards = messageCardContainers({
    messages: [replyMessage({ reactions: [{ senderId: 'self', emoji: '👍' }] })],
    selectedIndex: 0,
    replyMode: false,
    messageSelected: false,
    composerText: '/ Hold to reply',
    measureText,
    showReactions: false,
  })

  assert.doesNotMatch(cards.find((card) => card.containerName === 'msg-0-md').content, /👍/)
})

test('reactionsMenuContainers lists the selected message sender and reaction choices', () => {
  const { title, actions } = reactionsMenuContainers({
    selectedMessage: { sender: 'Grace' },
    reactionMenuItems: ['React 👍', 'React ❤️', 'React 😂', 'Remove reaction'],
  })

  assert.equal(title.content, 'React to Grace')
  assert.equal(actions.itemContainer.itemCount, 4)
  assert.deepEqual(actions.itemContainer.itemName, ['React 👍', 'React ❤️', 'React 😂', 'Remove reaction'])
})
