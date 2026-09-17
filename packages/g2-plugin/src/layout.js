import { ListContainerProperty, ListItemContainerProperty, TextContainerProperty } from '@evenrealities/even_hub_sdk'
import { clampTextToLines, formatCardBody, formatCardTime, formatCardTitle, formatMessageReactions, formatQuoteLines, wrapLines } from './format.js'

export const VISIBLE_CONVERSATIONS = 2
export const VISIBLE_MESSAGES = 2

// Documented SDK limit (textObject: max 8 items per page). The real
// "7 containers rejected" failure seen early on turned out to be caused by
// containerName length instead (see MAX_CONTAINER_NAME_LENGTH) - once names
// were shortened, this documented cap is the one actually worth respecting.
export const MAX_TEXT_CONTAINERS = 8
const COMPOSER_CONTAINER_COST = 1
const READER_BODY_WIDTH = 530
export const READER_BODY_LINES = 8
export const READER_QUOTED_BODY_LINES = 7

// Real G2 hardware silently rejects the whole page if any single
// container's containerName is too long - found by bisecting a real
// "Display error" down to one 22-char name ('conversation-scrollbar') while
// 15-char names worked fine. Exact cutoff unconfirmed, so every name below
// stays at or under this to be safe.
export const MAX_CONTAINER_NAME_LENGTH = 15

export function visibleWindow(items, selectedIndex, size) {
  const start = Math.min(
    Math.max(selectedIndex - Math.floor(size / 2), 0),
    Math.max(items.length - size, 0),
  )
  return { start, items: items.slice(start, start + size) }
}

export function statusContainer(content) {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: 1,
    containerName: 'main',
    content,
    isEventCapture: 1,
    zOrderIndex: 0,
  })
}

// Diagnostic: the glasses reject any rebuildPageContainer call whose
// containerTotalNum exceeds what createStartUpPageContainer originally
// declared, even well under the documented 1-12 range. This reserves a
// higher budget upfront with invisible placeholders so later screens can
// use more containers without growing past the initial declaration.
export function placeholderContainers(count, startId) {
  return Array.from({ length: count }, (_, index) => new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 1,
    height: 1,
    borderWidth: 0,
    paddingLength: 0,
    containerID: startId + index,
    containerName: `placeholder-${index}`,
    content: '',
    isEventCapture: 0,
    zOrderIndex: 90 + index,
  }))
}

// zOrderIndex only matters relative to other containers on the same page,
// so callers build cards without worrying about it, then this stamps draw
// order from final array position in one place.
function withZOrder(containers) {
  containers.forEach((container, index) => { container.zOrderIndex = index })
  return containers
}

function cardMetadata(item, reactions) {
  return reactions ? `${formatCardTime(item)}\n\n${reactions}` : formatCardTime(item)
}

function titleContainer(title, selected, yPosition, height, id, name) {
  return new TextContainerProperty({
    xPosition: 8,
    yPosition,
    width: 552,
    height,
    borderWidth: selected ? 3 : 0,
    borderRadius: 6,
    // Only set borderColor when there's actually a border - setting a
    // color on a zero-width (invisible) border was one discrepancy found
    // while chasing the real display bug.
    ...(selected ? { borderColor: 5 } : {}),
    paddingLength: 8,
    containerID: id,
    containerName: name,
    content: formatCardTitle(title),
    isEventCapture: selected ? 1 : 0,
    zOrderIndex: 0,
  })
}

function metadataContainer(item, reactions, yPosition, height, id, name) {
  return new TextContainerProperty({
    xPosition: 474,
    yPosition: yPosition + 10,
    width: 80,
    height: height - 16,
    borderWidth: 0,
    paddingLength: 0,
    containerID: id,
    containerName: `${name}-md`,
    content: cardMetadata(item, reactions),
    isEventCapture: 0,
    zOrderIndex: 0,
  })
}

// 3 containers per card: title, body, and a real right-aligned metadata
// column - see MAX_TEXT_CONTAINERS.
function cardContainers({ item, title, body, reactions = '', selected, yPosition, height, ids, name, bodyLines = 2, measureText }) {
  const bodyHeight = bodyLines * 24 + 14
  return [
    titleContainer(title, selected, yPosition, height, ids[0], name),
    new TextContainerProperty({
      xPosition: 20,
      yPosition: yPosition + 43,
      width: 452,
      height: bodyHeight,
      borderWidth: 0,
      paddingLength: 0,
      containerID: ids[1],
      containerName: `${name}-b`,
      content: formatCardBody(body, measureText, bodyLines),
      isEventCapture: 0,
      zOrderIndex: 0,
    }),
    metadataContainer(item, reactions, yPosition, height, ids[2], name),
  ]
}

// 4 containers: title, dimmed quote, body, and the metadata column - one
// more container than a plain card, since it adds the quote block.
function quoteReplyCardContainers({ message, reactions, selected, yPosition, height, quoteLines, quoteHeight, bodyLines, bodyHeight, ids, name, measureText }) {
  return [
    titleContainer(message.sender, selected, yPosition, height, ids[0], name),
    new TextContainerProperty({
      xPosition: 20,
      yPosition: yPosition + 43,
      width: 452,
      height: quoteHeight,
      borderWidth: 0,
      paddingLength: 0,
      containerID: ids[1],
      containerName: `${name}-q`,
      content: quoteLines.join('\n'),
      textColor: 1,
      isEventCapture: 0,
      zOrderIndex: 0,
    }),
    new TextContainerProperty({
      xPosition: 20,
      yPosition: yPosition + 43 + quoteHeight,
      width: 452,
      height: bodyHeight,
      borderWidth: 0,
      paddingLength: 0,
      containerID: ids[2],
      containerName: `${name}-b`,
      content: formatCardBody(message.body, measureText, bodyLines),
      isEventCapture: 0,
      zOrderIndex: 0,
    }),
    metadataContainer(message, reactions, yPosition, height, ids[3], name),
  ]
}

function messageContainerCost(message) {
  return message.quote ? 4 : 3
}

export function scrollbarContainer(total, visible, selectedIndex, yPosition, trackHeight, containerID, containerName) {
  if (total <= visible) return null
  const height = Math.max(24, Math.floor(trackHeight * visible / total))
  const offset = Math.round((trackHeight - height) * selectedIndex / (total - 1))
  return new TextContainerProperty({
    xPosition: 560,
    yPosition: yPosition + offset,
    width: 4,
    height,
    borderWidth: 2,
    borderColor: 5,
    paddingLength: 0,
    containerID,
    containerName,
    content: '',
    isEventCapture: 0,
    zOrderIndex: 0,
  })
}

export function conversationCardContainers({ conversations, selectedIndex, measureText, showReactions = true }) {
  const window = visibleWindow(conversations, selectedIndex, VISIBLE_CONVERSATIONS)
  const cards = window.items.flatMap((conversation, slot) => {
    const index = window.start + slot
    const base = 200 + slot * 3
    return cardContainers({
      item: conversation,
      title: conversation.title,
      body: conversation.latestMessage,
      reactions: showReactions ? formatMessageReactions(conversation) : '',
      selected: index === selectedIndex,
      yPosition: 8 + slot * 142,
      height: 134,
      ids: [base, base + 1, base + 2],
      name: `conv-${index}`,
      measureText,
    })
  })
  const scrollbar = scrollbarContainer(
    conversations.length,
    VISIBLE_CONVERSATIONS,
    selectedIndex,
    8,
    264,
    206,
    'conv-scrollbar',
  )
  return withZOrder(scrollbar ? [...cards, scrollbar] : cards)
}

export function readerPageInfo(message, lineOffset = 0, measureText) {
  const visibleLines = message.quote ? READER_QUOTED_BODY_LINES : READER_BODY_LINES
  const lines = wrapLines(message.body ?? '', {
    maxWidth: READER_BODY_WIDTH,
    maxLines: Infinity,
    measureText,
  })
  if (lines.length === 0) lines.push('')
  const maxOffset = Math.max(lines.length - visibleLines, 0)
  const offset = Math.min(Math.max(lineOffset, 0), maxOffset)
  return {
    lines,
    visibleLines,
    offset,
    maxOffset,
    pageStep: Math.max(visibleLines - 1, 1),
  }
}

function readerScrollbarContainer(page, yPosition, trackHeight) {
  if (page.maxOffset === 0) return null
  const height = Math.max(24, Math.floor(trackHeight * page.visibleLines / page.lines.length))
  const offset = Math.round((trackHeight - height) * page.offset / page.maxOffset)
  return new TextContainerProperty({
    xPosition: 560,
    yPosition: yPosition + offset,
    width: 4,
    height,
    borderWidth: 2,
    borderColor: 5,
    paddingLength: 0,
    containerID: 44,
    containerName: 'reader-scroll',
    content: '',
    isEventCapture: 0,
    zOrderIndex: 0,
  })
}

export function messageReaderContainers({ message, lineOffset = 0, measureText }) {
  const page = readerPageInfo(message, lineOffset, measureText)
  const bodyY = message.quote ? 78 : 48
  const containers = [titleContainer(message.sender, true, 4, 280, 40, 'reader')]

  if (message.quote) {
    containers.push(new TextContainerProperty({
      xPosition: 20,
      yPosition: 46,
      width: READER_BODY_WIDTH,
      height: 28,
      borderWidth: 0,
      paddingLength: 0,
      containerID: 41,
      containerName: 'reader-quote',
      content: formatQuoteLines(message.quote, {
        maxWidth: READER_BODY_WIDTH,
        maxLines: 1,
        measureText,
      }).join('\n'),
      textColor: 1,
      isEventCapture: 0,
      zOrderIndex: 0,
    }))
  }

  containers.push(
    new TextContainerProperty({
      xPosition: 20,
      yPosition: bodyY,
      width: READER_BODY_WIDTH,
      height: page.visibleLines * 24 + 4,
      borderWidth: 0,
      paddingLength: 0,
      containerID: 42,
      containerName: 'reader-body',
      content: page.lines.slice(page.offset, page.offset + page.visibleLines).join('\n'),
      isEventCapture: 0,
      zOrderIndex: 0,
    }),
    metadataContainer(message, '', 4, 280, 43, 'reader'),
  )

  const scrollbar = readerScrollbarContainer(page, bodyY, page.visibleLines * 24)
  return withZOrder(scrollbar ? [...containers, scrollbar] : containers)
}

// Lays out the message list, the composer, and (when there's room left in
// the container budget) the scrollbar. When two visible reply cards would
// push the page over MAX_TEXT_CONTAINERS, falls back to showing just the
// selected message at full quality rather than degrading either card.
export function messageCardContainers({ messages, selectedIndex, replyMode, messageSelected, composerText, readerLineOffset = 0, measureText, showReactions = true }) {
  if (messageSelected && messages[selectedIndex]) {
    return messageReaderContainers({
      message: messages[selectedIndex],
      lineOffset: readerLineOffset,
      measureText,
    })
  }

  const focused = replyMode
  let visibleMessages = focused ? 1 : VISIBLE_MESSAGES
  let window = visibleWindow(messages, selectedIndex, visibleMessages)

  if (!focused && window.items.length > 1) {
    const cost = window.items.reduce((sum, message) => sum + messageContainerCost(message), COMPOSER_CONTAINER_COST)
    if (cost > MAX_TEXT_CONTAINERS) {
      visibleMessages = 1
      window = visibleWindow(messages, selectedIndex, 1)
    }
  }

  let yPosition = 4
  let containerCount = COMPOSER_CONTAINER_COST
  const cards = window.items.flatMap((message, slot) => {
    const index = window.start + slot
    const isSelected = index === selectedIndex
    const expand = false
    const base = 20 + slot * 4
    const ids = [base, base + 1, base + 2, base + 3]
    let height
    let card

    if (message.quote) {
      const pad = expand ? 14 : 6
      const bodyLines = expand ? 3 : 1
      const quoteLines = formatQuoteLines(message.quote, {
        maxWidth: 452,
        maxLines: expand ? 12 : 1,
        measureText,
      })
      const quoteHeight = quoteLines.length * 24 + pad
      const bodyHeight = bodyLines * 24 + pad
      height = expand ? 43 + quoteHeight + bodyHeight + 6 : 104
      card = quoteReplyCardContainers({
        message,
        reactions: showReactions ? formatMessageReactions(message) : '',
        selected: isSelected,
        yPosition,
        height,
        quoteLines,
        quoteHeight,
        bodyLines,
        bodyHeight,
        ids,
        name: `msg-${index}`,
        measureText,
      })
    } else {
      height = expand ? 172 : 104
      card = cardContainers({
        item: message,
        title: message.sender,
        body: message.body,
        reactions: showReactions ? formatMessageReactions(message) : '',
        selected: isSelected,
        yPosition,
        height,
        bodyLines: expand ? 4 : 2,
        ids,
        name: `msg-${index}`,
        measureText,
      })
    }

    containerCount += messageContainerCost(message)
    yPosition += height + 6
    return card
  })

  const composerSelected = selectedIndex === messages.length
  const composerContent = replyMode
    ? clampTextToLines(composerText, { maxWidth: 530, maxLines: 5, measureText })
    : composerText
  const composerLines = composerContent.split('\n').length
  const composerHeight = replyMode ? Math.min(166, 48 + composerLines * 28) : 56
  cards.push(new TextContainerProperty({
    xPosition: 8,
    yPosition: 284 - composerHeight,
    width: 552,
    height: composerHeight,
    borderWidth: composerSelected ? 3 : 1,
    borderColor: 5,
    paddingLength: 4,
    containerID: 29,
    containerName: 'reply-composer',
    content: composerContent,
    isEventCapture: composerSelected ? 1 : 0,
    zOrderIndex: 0,
  }))

  const scrollbar = !focused
    && containerCount + 1 <= MAX_TEXT_CONTAINERS
    && scrollbarContainer(
      messages.length,
      VISIBLE_MESSAGES,
      Math.min(selectedIndex, messages.length - 1),
      4,
      214,
      28,
      'msg-scrollbar',
    )
  return withZOrder(scrollbar ? [...cards, scrollbar] : cards)
}

export function reactionsMenuContainers({ selectedMessage, reactionMenuItems }) {
  const title = new TextContainerProperty({
    xPosition: 8,
    yPosition: 4,
    width: 560,
    height: 48,
    borderWidth: 0,
    paddingLength: 6,
    containerID: 30,
    containerName: 'actions-title',
    content: `React to ${selectedMessage.sender}`,
    isEventCapture: 0,
    zOrderIndex: 0,
  })
  const actions = new ListContainerProperty({
    xPosition: 8,
    yPosition: 60,
    width: 560,
    height: 220,
    borderWidth: 0,
    paddingLength: 6,
    containerID: 31,
    containerName: 'message-actions',
    itemContainer: new ListItemContainerProperty({
      itemCount: reactionMenuItems.length,
      itemWidth: 548,
      isItemSelectBorderEn: 1,
      itemName: reactionMenuItems,
    }),
    isEventCapture: 1,
    zOrderIndex: 1,
  })
  return { title, actions }
}
