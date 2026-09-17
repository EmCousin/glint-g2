import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyReactionOverride,
  chronologicalMessages,
  clampTextToLines,
  formatConversationCard,
  formatCardTime,
  formatMessageCard,
  formatMessageReactions,
  formatQuoteLines,
  formatRelativeTime,
  formatReplyConfirmation,
} from '../src/format.js'

test('formatMessageCard includes its sender and trimmed body', () => {
  const output = formatMessageCard({
    sender: 'Ada',
    body: 'Hello',
  })

  assert.match(output, /^Ada\n/)
  assert.match(output, /Hello/)
  assert.equal(output.split('\n').length, 3)
})

test('formatMessageCard truncates collapsed previews', () => {
  const output = formatMessageCard({ sender: 'Ada', time: '10:30', body: 'x'.repeat(200) })

  assert.match(output, /\.\.\./)
  assert.ok(output.length < 100)
})

test('formatQuoteLines prefixes each wrapped line with a markdown blockquote marker', () => {
  const lines = formatQuoteLines(
    { sender: 'Grace', body: 'Are we still on for lunch tomorrow at noon?' },
    { maxWidth: 40, maxLines: 3, measureText: (text) => text.length },
  )

  assert.ok(lines.length > 1)
  assert.ok(lines.every((line) => line.startsWith('> ')))
  assert.match(lines[0], /^> Grace: /)
})

test('formatQuoteLines shows the full quote without truncation when unbounded', () => {
  const body = 'one two three four five six seven eight nine ten'
  const lines = formatQuoteLines(
    { sender: 'Grace', body },
    { maxWidth: 20, maxLines: Infinity, measureText: (text) => text.length },
  )

  assert.ok(lines.length > 2)
  assert.ok(!lines.some((line) => line.includes('...')))
  assert.equal(lines.join(' ').replace(/> /g, ''), `Grace: ${body}`)
})

test('clampTextToLines fills two measured lines before truncating', () => {
  const output = clampTextToLines('one two three four five six seven', {
    maxWidth: 14,
    measureText: (text) => text.length,
  })

  const lines = output.split('\n')
  assert.deepEqual(lines[0], 'one two three')
  assert.equal(lines.length, 2)
  assert.match(lines[1], /\.\.\.$/)
  assert.ok(lines.every((line) => line.length <= 14))
})

test('formatMessageReactions shows the three most common emoji and total count', () => {
  const message = {
    sender: 'Ada',
    time: '10:30',
    body: 'Hello',
    reactions: [
      { emoji: '😂' },
      { emoji: '👍' },
      { emoji: '❤️' },
      { emoji: '👍' },
      { emoji: '😮' },
      { emoji: '❤️' },
      { emoji: '👍' },
    ],
  }

  assert.doesNotMatch(formatMessageCard(message), /👍|❤️|😂/)
  assert.equal(formatMessageReactions(message), '👍❤️😂(7)')
})

test('formatMessageReactions counts one reaction per sender', () => {
  assert.equal(formatMessageReactions({
    reactions: [
      { senderId: 'ada', emoji: '👍' },
      { senderId: 'ada', emoji: '👍' },
      { senderId: 'grace', emoji: '❤️' },
    ],
  }), '👍❤️(2)')
})

test('applyReactionOverride keeps repeated local reactions idempotent', () => {
  const message = { reactions: [{ senderId: 'self', emoji: '👍' }] }
  const updated = applyReactionOverride(message, { emoji: '👍', remove: false })

  assert.deepEqual(updated.reactions, [{ senderId: 'self', emoji: '👍' }])
})

test('chronologicalMessages orders oldest to newest without mutating input', () => {
  const messages = [{ timestamp: 20 }, { timestamp: 10 }]

  assert.deepEqual(chronologicalMessages(messages), [{ timestamp: 10 }, { timestamp: 20 }])
  assert.deepEqual(messages, [{ timestamp: 20 }, { timestamp: 10 }])
})

test('formatReplyConfirmation shows the locked recipient, text, and controls', () => {
  const output = formatReplyConfirmation({ recipient: 'Ada', message: 'Yes' })

  assert.match(output, /Reply to Ada/)
  assert.match(output, /Yes/)
  assert.match(output, /Press: send/)
  assert.match(output, /Swipe: cancel/)
})

test('formatConversationCard renders a compact two-line preview', () => {
  const output = formatConversationCard({
    title: 'A contact with a name that is much too long',
    latestMessage: 'A detailed latest message '.repeat(6),
  })
  const [title, , ...previewLines] = output.split('\n')

  assert.equal(title, 'A contact with a name tha...')
  assert.match(previewLines.at(-1), /\.\.\.$/)
  assert.equal(previewLines.length, 2)
})

test('formatConversationCard preserves supported emoji in conversation names', () => {
  const output = formatConversationCard({
    title: 'FoodEaters 🥬🐮 ✈️',
    latestMessage: 'Dinner plans',
  })

  assert.match(output, /^FoodEaters 🥬🐮 ✈️\n/)
})

test('formatRelativeTime follows compact desktop-style recent timestamps', () => {
  const now = new Date('2026-09-03T12:00:00Z').getTime()

  assert.equal(formatRelativeTime(now - 30_000, now), 'Now')
  assert.equal(formatRelativeTime(now - 60_000, now), '1m')
  assert.equal(formatRelativeTime(now - 20 * 60_000, now), '20m')
  assert.equal(formatRelativeTime(now - 60 * 60_000, now), '1h')
  assert.match(formatRelativeTime(new Date('2026-08-30T12:00:00Z').getTime(), now), /Aug 30/)
  assert.equal(formatCardTime({ timestamp: now - 20 * 60_000 }, now), '20m')
})
