const MAX_TITLE_LENGTH = 28
const CARD_BODY_WIDTH = 452

function truncate(value, maxLength) {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 3)}...`
    : value
}

export function formatCardTitle(title) {
  return truncate(title, MAX_TITLE_LENGTH)
}

export function wrapLines(value, {
  maxWidth = CARD_BODY_WIDTH,
  maxLines = 2,
  measureText = (text) => [...text].length * 12,
} = {}) {
  const words = value.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const lines = []

  while (words.length > 0 && lines.length < maxLines) {
    let line = ''
    while (words.length > 0) {
      const candidate = line ? `${line} ${words[0]}` : words[0]
      if (measureText(candidate) <= maxWidth) {
        line = candidate
        words.shift()
        continue
      }
      if (line) break

      const characters = [...words.shift()]
      while (characters.length > 0 && measureText(line + characters[0]) <= maxWidth) {
        line += characters.shift()
      }
      if (characters.length > 0) words.unshift(characters.join(''))
      break
    }
    lines.push(line)
  }

  if (words.length > 0 && lines.length > 0) {
    const ellipsis = '...'
    let lastLine = lines.at(-1)
    while (lastLine && measureText(lastLine + ellipsis) > maxWidth) {
      lastLine = [...lastLine].slice(0, -1).join('').trimEnd()
    }
    lines[lines.length - 1] = `${lastLine}${ellipsis}`
  }
  return lines
}

export function clampTextToLines(value, options) {
  return wrapLines(value, options).join('\n')
}

export function formatCardBody(body, measureText, maxLines = 2) {
  return clampTextToLines(body, { measureText, maxLines })
}

export function formatQuoteLines(quote, {
  maxWidth = CARD_BODY_WIDTH,
  maxLines = 1,
  measureText = (text) => [...text].length * 12,
} = {}) {
  const label = quote.sender ? `${quote.sender}: ` : ''
  const prefixWidth = measureText('> ')
  const lines = wrapLines(`${label}${quote.body ?? ''}`, {
    maxWidth: Math.max(1, maxWidth - prefixWidth),
    maxLines,
    measureText,
  })
  return lines.map((line) => `> ${line}`)
}

export function formatRelativeTime(timestamp, now = Date.now()) {
  if (!Number.isFinite(timestamp)) return ''

  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < 60_000) return 'Now'
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)}m`
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))}h`

  const date = new Date(timestamp)
  const current = new Date(now)
  if (date.getFullYear() === current.getFullYear()) {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  }).format(date)
}

export function formatConversationCard(conversation) {
  return `${formatCardTitle(conversation.title)}\n\n${formatCardBody(conversation.latestMessage)}`
}

export function formatMessageCard(message) {
  return `${formatCardTitle(message.sender)}\n\n${formatCardBody(message.body)}`
}

export function formatMessageReactions(message) {
  const reactionsBySender = new Map()
  for (const [index, reaction] of (message.reactions ?? []).entries()) {
    reactionsBySender.set(reaction.senderId ?? `unknown-${index}`, reaction.emoji)
  }
  const counts = new Map()
  for (const emoji of reactionsBySender.values()) {
    counts.set(emoji, (counts.get(emoji) ?? 0) + 1)
  }
  const emojis = [...counts]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([emoji]) => emoji)
    .join('')
  return emojis ? `${emojis}(${reactionsBySender.size})` : ''
}

export function applyReactionOverride(message, override) {
  const reactions = message.reactions ?? []
  if (override.remove) {
    const removalIndex = reactions.findIndex(({ senderId, emoji }) => (
      senderId === 'self' || emoji === override.emoji
    ))
    return { ...message, reactions: reactions.filter((_reaction, index) => index !== removalIndex) }
  }

  let next = reactions.filter(({ senderId }) => senderId !== 'self')
  if (override.previousEmoji && override.previousEmoji !== override.emoji) {
    const previousIndex = next.findIndex(({ emoji }) => emoji === override.previousEmoji)
    next = next.filter((_reaction, index) => index !== previousIndex)
  }
  if (!next.some(({ emoji }) => emoji === override.emoji)) {
    next.push({ senderId: 'self', emoji: override.emoji })
  }
  return { ...message, reactions: next }
}

export function chronologicalMessages(messages) {
  return messages.slice().sort((left, right) => left.timestamp - right.timestamp)
}

export function formatCardTime(item, now = Date.now()) {
  return item.timestamp
    ? formatRelativeTime(item.timestamp, now)
    : item.time
}

export function formatStatus(title, detail, footer = 'Double-press to exit') {
  return `${title}\n\n${detail}\n\n${footer}`
}

export function formatReplyConfirmation({ recipient, message }) {
  return `Reply to ${recipient}\n\n${message}\n\nPress: send\nSwipe: cancel`
}
