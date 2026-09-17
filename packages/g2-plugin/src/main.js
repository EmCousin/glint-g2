import {
  AudioInputSource,
  CreateStartUpPageContainer,
  OsEventTypeList,
  RebuildPageContainer,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { createBridgeClient } from './api.js'
import { gestureFromEvent } from './gestures.js'
import { applyReactionOverride, chronologicalMessages, formatStatus } from './format.js'
import { conversationCardContainers, MAX_TEXT_CONTAINERS, messageCardContainers, placeholderContainers, reactionsMenuContainers, readerPageInfo, statusContainer } from './layout.js'
import { initializeMobileCompanion, loadBridgeSettings, renderMobilePage, renderMobileStatus, setMobileConnectionStatus, updateMobileListSelection } from './mobile.js'
import './styles.css'

const MAX_RECORDING_BYTES = 16_000 * 2 * 60
const REFRESH_INTERVAL_MS = 5_000
const DICTATION_PREVIEW_INTERVAL_MS = 2_500
export async function startGlintPlugin(config) {
const {
  appId,
  appName,
  displayName,
  logSlug,
  devBridgeUrl,
  devBridgeToken,
  bridgeUrl,
  bridgeToken,
  emptyStateTitle = 'No conversations',
  emptyStateDetail = `The bridge returned no ${appName} conversations.`,
  replyFailureDetail = `The draft expired or ${appName} was unavailable.`,
  allowedHealthProviders,
  capabilities: {
    reactions = false,
    quotedReplies = false,
  } = {},
} = config
const bridge = await waitForEvenAppBridge()
const bridgeSettings = await loadBridgeSettings(bridge, appId, {
  url: bridgeUrl || devBridgeUrl,
  token: bridgeToken || devBridgeToken,
})
const measureContext = document.createElement('canvas').getContext('2d')
if (measureContext) measureContext.font = '24px sans-serif'

function measureDisplayText(value) {
  return measureContext?.measureText(value).width ?? [...value].length * 12
}

// Declares the full container budget up front - see placeholderContainers
// for why. The startup screen itself only ever shows one real container.
const startupPlaceholders = placeholderContainers(MAX_TEXT_CONTAINERS - 1, 90)
renderMobileStatus(formatStatus(displayName, 'Connecting to bridge...'))
const result = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: MAX_TEXT_CONTAINERS,
    textObject: [statusContainer(formatStatus(displayName, 'Connecting to bridge...')), ...startupPlaceholders],
  }),
)

if (result !== 0) console.error('createStartUpPageContainer failed:', result)

// The bridge API client and the two interval handles are infrastructure
// handles, not UI state, so they live outside `state`.
let client
let refreshTimer
let previewTimer

const state = {
  view: 'loading',
  navigationSequence: 0,

  conversations: [],
  selectedConversationIndex: 0,
  conversationNextCursor: null,
  conversationsHaveMore: false,
  loadingMoreConversations: false,

  activeConversation: null,
  messages: [],
  selectedMessageIndex: 0,
  messageSelected: false,
  readerLineOffset: 0,
  messageNextCursor: null,
  messagesHaveMore: false,
  loadingMoreMessages: false,

  composerText: '/ Hold to reply',
  replyMode: false,
  replyToMessage: null,
  pendingDraft: null,

  recording: false,
  recordingChunks: [],
  recordingBytes: 0,
  previewInFlight: false,
  lastPreviewBytes: 0,

  busy: false,
  refreshing: false,

  selectedActionIndex: 0,
  reactionMenuItems: [],

  optimisticMessages: [],
  optimisticConversationMessages: new Map(),
  reactionOverrides: new Map(),
}

function idleComposerText() {
  if (quotedReplies && state.selectedMessageIndex === state.messages.length) return '/ Hold to write a message'
  return state.messageSelected && reactions ? '/ Hold for reactions' : '/ Hold to reply'
}

function showIdleComposer() {
  state.composerText = idleComposerText()
  renderMessageCards()
}

function deselectAndShowIdle() {
  state.messageSelected = false
  state.readerLineOffset = 0
  showIdleComposer()
}

// Leaves the reply/react flow for the current message: drops any pending
// draft, quote target, and reply mode, and closes the expanded message.
function resetReplyFlow() {
  state.pendingDraft = null
  state.replyToMessage = null
  state.replyMode = false
  state.messageSelected = false
  state.readerLineOffset = 0
}

function render(content) {
  rebuildText(content).catch(console.error)
}

function rebuildText(content) {
  renderMobileStatus(content)
  return bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: 1,
      textObject: [statusContainer(content)],
    }),
  )
}

// Dumps every field actually sent, so a rejection is visible on the device
// itself (via debugLog) instead of reconstructed by hand off-device.
function describeContainer(c) {
  return `${c.containerID} ${c.containerName}:${c.xPosition},${c.yPosition},${c.width},${c.height} bw${c.borderWidth ?? '-'} bc${c.borderColor ?? '-'} pd${c.paddingLength ?? '-'} cap${c.isEventCapture ?? '-'} z${c.zOrderIndex ?? '-'} content(${c.content.length})=${JSON.stringify(c.content)}`
}

function renderConversationCards() {
  const cards = conversationCardContainers({
    conversations: state.conversations,
    selectedIndex: state.selectedConversationIndex,
    measureText: measureDisplayText,
    showReactions: reactions,
  })
  renderMobilePage(cards)
  return bridge.rebuildPageContainer(
    new RebuildPageContainer({ containerTotalNum: cards.length, textObject: cards }),
  ).then((accepted) => {
    if (!accepted) {
      const dump = cards.map(describeContainer).join('\n')
      render(formatStatus('Display error', dump))
      client?.debugLog(dump).catch(console.error)
    }
    return accepted
  })
}

function threadStatus(title, detail) {
  return formatStatus(title, detail, 'Double-press: conversations')
}

function renderMessageCards() {
  if (state.messages.length === 0) {
    render(threadStatus(state.activeConversation.title, 'No recent messages in this conversation.'))
    return
  }

  const cards = messageCardContainers({
    messages: state.messages,
    selectedIndex: state.selectedMessageIndex,
    replyMode: state.replyMode,
    messageSelected: state.messageSelected,
    composerText: state.composerText,
    readerLineOffset: state.readerLineOffset,
    measureText: measureDisplayText,
    showReactions: reactions,
  })
  renderMobilePage(cards)
  bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: cards.length,
      textObject: cards,
    }),
  ).then((accepted) => {
    if (!accepted) render(formatStatus('Display error', `Message list rejected (${cards.length} containers).`))
  }).catch(console.error)
}

function renderReactionsMenu() {
  state.view = 'actions'
  state.selectedActionIndex = 0
  const selectedMessage = state.messages[state.selectedMessageIndex]
  const hasOwnReaction = selectedMessage.reactions?.some(({ senderId }) => senderId === 'self') ?? false
  state.reactionMenuItems = hasOwnReaction
    ? ['React 👍', 'React ❤️', 'React 😂', 'Remove reaction']
    : ['React 👍', 'React ❤️', 'React 😂']
  const { title, actions } = reactionsMenuContainers({ selectedMessage, reactionMenuItems: state.reactionMenuItems })
  renderMobilePage([title], [actions])
  bridge.rebuildPageContainer(new RebuildPageContainer({
    containerTotalNum: 2,
    textObject: [title],
    listObject: [actions],
  })).then((accepted) => {
    if (!accepted) render(formatStatus('Display error', 'Reactions menu rejected.'))
  }).catch(console.error)
}

async function showConversationList() {
  state.navigationSequence += 1
  state.view = 'conversations'
  state.activeConversation = null
  state.messages = []
  state.messageNextCursor = null
  state.messagesHaveMore = false
  state.optimisticMessages = []
  resetReplyFlow()
  state.recording = false
  clearInterval(previewTimer)
  state.recordingChunks = []
  state.recordingBytes = 0
  await bridge.audioControl(false)

  if (state.conversations.length === 0) {
    await rebuildText(formatStatus(emptyStateTitle, emptyStateDetail))
    return
  }

  await renderConversationCards()
}

async function openConversation(index) {
  const conversation = state.conversations[index]
  if (!conversation) return

  const sequence = ++state.navigationSequence
  state.view = 'messages'
  state.activeConversation = conversation
  state.messages = []
  state.selectedMessageIndex = 0
  state.readerLineOffset = 0
  state.optimisticMessages = []
  resetReplyFlow()
  state.composerText = '/ Hold to reply'
  await rebuildText(threadStatus(conversation.title, 'Loading messages...'))

  try {
    const response = await client.recentMessages(conversation.id)
    if (sequence !== state.navigationSequence || state.view !== 'messages') return
    state.messages = chronologicalMessages(response.messages)
    state.messageNextCursor = response.nextCursor
    state.messagesHaveMore = response.hasMore
    state.selectedMessageIndex = Math.max(state.messages.length - 1, 0)
    state.composerText = idleComposerText()
    renderMessageCards()
  } catch (error) {
    console.error(error)
    if (sequence === state.navigationSequence && state.view === 'messages') {
      render(threadStatus(conversation.title, 'Messages could not be loaded.'))
    }
  }
}

async function loadConversations() {
  if (!bridgeSettings.url || !bridgeSettings.token) {
    setMobileConnectionStatus('Setup required', 'error')
    await rebuildText(formatStatus('Setup required', `Open ${displayName} in the Even app to configure the bridge.`))
    throw new Error('Enter the bridge endpoint and token.')
  }

  try {
    setMobileConnectionStatus('Connecting')
    client = createBridgeClient({ baseUrl: bridgeSettings.url, token: bridgeSettings.token })
    if (allowedHealthProviders) {
      const health = await client.health()
      if (!allowedHealthProviders.includes(health.provider)) {
        throw new Error(`Wrong bridge provider: ${health.provider ?? 'unknown'}`)
      }
    }
    const response = await client.recentConversations()
    state.conversations = response.conversations
    state.conversationNextCursor = response.nextCursor
    state.conversationsHaveMore = response.hasMore
    state.selectedConversationIndex = 0
    await showConversationList()
    setMobileConnectionStatus('Connected', 'success')
    console.log(`[${logSlug}] ready`)
  } catch (error) {
    console.error(error)
    setMobileConnectionStatus('Unavailable', 'error')
    await rebuildText(formatStatus('Bridge unavailable', 'Check the URL, token, and Tailscale connection.'))
    throw error
  }
}

function mergeOptimisticMessages(serverMessages) {
  state.optimisticMessages = state.optimisticMessages.filter((optimistic) => !serverMessages.some((message) => (
    message.timestamp === optimistic.timestamp
    || (message.body === optimistic.body && Math.abs(message.timestamp - optimistic.timestamp) < 10_000)
  )))
  const merged = new Map(state.messages.map((message) => [message.id, message]))
  for (const message of serverMessages) merged.set(message.id, message)
  for (const message of state.optimisticMessages) merged.set(message.id, message)
  return chronologicalMessages([...merged.values()]
    .map((message) => {
      const override = state.reactionOverrides.get(message.id)
      return override ? applyReactionOverride(message, override) : message
    }))
}

function mergeConversationUpdates(serverConversations) {
  const mergedById = new Map(state.conversations.map((conversation) => [conversation.id, conversation]))
  for (const conversation of serverConversations) {
    const optimistic = state.optimisticConversationMessages.get(conversation.id)
    let merged = conversation
    if (optimistic && (conversation.timestamp >= optimistic.timestamp || conversation.latestMessage === optimistic.body)) {
      state.optimisticConversationMessages.delete(conversation.id)
    } else if (optimistic) {
      merged = { ...conversation, latestMessage: optimistic.body, timestamp: optimistic.timestamp }
    }
    const reactionOverride = state.reactionOverrides.get(`${merged.id}:${merged.timestamp}`)
    mergedById.set(conversation.id, reactionOverride ? applyReactionOverride(merged, reactionOverride) : merged)
  }
  return [...mergedById.values()].sort((left, right) => right.timestamp - left.timestamp)
}

async function loadMoreConversations() {
  if (!state.conversationsHaveMore || !state.conversationNextCursor || state.loadingMoreConversations) return
  state.loadingMoreConversations = true
  const cursor = state.conversationNextCursor
  try {
    const response = await client.recentConversations(cursor)
    if (cursor !== state.conversationNextCursor) return
    state.conversations = mergeConversationUpdates(response.conversations)
    state.conversationNextCursor = response.nextCursor
    state.conversationsHaveMore = response.hasMore
    if (state.view === 'conversations') await renderConversationCards()
  } catch (error) {
    console.error(error)
  } finally {
    state.loadingMoreConversations = false
  }
}

async function loadOlderMessages() {
  if (!state.messagesHaveMore || !state.messageNextCursor || state.loadingMoreMessages || !state.activeConversation) return
  state.loadingMoreMessages = true
  const cursor = state.messageNextCursor
  const conversationId = state.activeConversation.id
  try {
    const response = await client.recentMessages(conversationId, cursor)
    if (state.activeConversation?.id !== conversationId || cursor !== state.messageNextCursor) return
    const selectedId = state.messages[state.selectedMessageIndex]?.id
    state.messages = mergeOptimisticMessages(response.messages)
    state.messageNextCursor = response.nextCursor
    state.messagesHaveMore = response.hasMore
    if (selectedId) state.selectedMessageIndex = Math.max(0, state.messages.findIndex(({ id }) => id === selectedId))
    if (state.view === 'messages') renderMessageCards()
  } catch (error) {
    console.error(error)
  } finally {
    state.loadingMoreMessages = false
  }
}

async function refreshCurrentView() {
  if (!client || state.busy || state.recording || state.pendingDraft || state.refreshing) return
  state.refreshing = true

  try {
    const selectedConversationId = state.conversations[state.selectedConversationIndex]?.id
    const conversationRequest = client.recentConversations()

    if (state.view === 'conversations') {
      const response = await conversationRequest
      state.conversations = mergeConversationUpdates(response.conversations)
      state.selectedConversationIndex = Math.max(0, state.conversations.findIndex(({ id }) => id === selectedConversationId))
      await renderConversationCards()
      return
    }

    if (state.view === 'messages' && state.activeConversation) {
      const conversationId = state.activeConversation.id
      const selectedId = state.messages[state.selectedMessageIndex]?.id
      const wasNewestSelected = state.selectedMessageIndex === state.messages.length - 1
      const [conversationResponse, messageResponse] = await Promise.all([
        conversationRequest,
        client.recentMessages(conversationId),
      ])
      if (state.view !== 'messages' || state.activeConversation?.id !== conversationId) return
      state.conversations = mergeConversationUpdates(conversationResponse.conversations)
      state.activeConversation = state.conversations.find(({ id }) => id === conversationId) ?? state.activeConversation
      state.messages = mergeOptimisticMessages(messageResponse.messages)
      state.selectedMessageIndex = wasNewestSelected
        ? Math.max(state.messages.length - 1, 0)
        : Math.max(0, state.messages.findIndex(({ id }) => id === selectedId))
      renderMessageCards()
      return
    }

    await conversationRequest
  } finally {
    state.refreshing = false
  }
}

async function startDictation() {
  const sequence = state.navigationSequence
  state.recording = true
  state.recordingChunks = []
  state.recordingBytes = 0
  state.lastPreviewBytes = 0
  state.composerText = '/ Listening...'
  renderMessageCards()
  const opened = await bridge.audioControl(true, AudioInputSource.Glasses)
  if (sequence !== state.navigationSequence || state.view !== 'messages' || !state.recording) {
    state.recording = false
    await bridge.audioControl(false)
    return
  }
  if (!opened) {
    state.recording = false
    state.composerText = '/ Microphone unavailable'
    renderMessageCards()
    return
  }
  previewTimer = setInterval(() => requestDictationPreview().catch(console.error), DICTATION_PREVIEW_INTERVAL_MS)
}

function recordingPcm() {
  const pcm = new Uint8Array(state.recordingBytes)
  let offset = 0
  for (const chunk of state.recordingChunks) {
    pcm.set(chunk, offset)
    offset += chunk.length
  }
  return pcm
}

async function requestDictationPreview() {
  if (!state.recording || state.previewInFlight || state.recordingBytes < 32_000 || state.recordingBytes === state.lastPreviewBytes) return
  state.previewInFlight = true
  const previewBytes = state.recordingBytes
  try {
    const { text } = await client.previewDictation(recordingPcm())
    if (state.recording && text) {
      state.lastPreviewBytes = previewBytes
      state.composerText = `/ ${text}`
      renderMessageCards()
    }
  } finally {
    state.previewInFlight = false
  }
}

async function finishDictation() {
  const sequence = state.navigationSequence
  const conversationId = state.activeConversation.id
  state.recording = false
  clearInterval(previewTimer)
  await bridge.audioControl(false)
  if (state.recordingBytes === 0) {
    state.composerText = '/ No speech captured · Hold to try again'
    renderMessageCards()
    return
  }

  state.busy = true
  state.composerText = '/ Transcribing...'
  renderMessageCards()
  const pcm = recordingPcm()
  state.recordingChunks = []

  try {
    const draft = await client.dictateReply(conversationId, pcm, state.replyToMessage?.id)
    if (sequence !== state.navigationSequence || state.view !== 'messages') return
    state.pendingDraft = draft
    state.composerText = `/ ${draft.message} · Press to send · Swipe to cancel`
    renderMessageCards()
  } catch (error) {
    console.error(error)
    if (sequence === state.navigationSequence && state.view === 'messages') {
      state.composerText = '/ Dictation failed · Hold to try again'
      renderMessageCards()
    }
  } finally {
    state.busy = false
  }
}

function executeReactionAction(label) {
  const selectedMessage = state.messages[state.selectedMessageIndex]
  if (!selectedMessage || state.busy) return
  state.view = 'messages'
  state.messageSelected = false

  const remove = label === 'Remove reaction'
  const existingReaction = selectedMessage.reactions?.find(({ senderId }) => senderId === 'self')
  const emoji = remove ? existingReaction?.emoji : { 'React 👍': '👍', 'React ❤️': '❤️', 'React 😂': '😂' }[label]
  if (!emoji) {
    showIdleComposer()
    return
  }

  const sequence = state.navigationSequence
  state.busy = true
  client.react(state.activeConversation.id, selectedMessage.id, emoji, remove)
    .then(() => {
      if (sequence === state.navigationSequence && state.view === 'messages') {
        const previousOverride = state.reactionOverrides.get(selectedMessage.id)
        const override = {
          emoji,
          remove,
          previousEmoji: previousOverride?.emoji ?? existingReaction?.emoji,
        }
        selectedMessage.reactions = applyReactionOverride(selectedMessage, override).reactions
        state.reactionOverrides.set(selectedMessage.id, override)
        if (selectedMessage.timestamp === state.activeConversation.timestamp) {
          state.activeConversation.reactions = selectedMessage.reactions
        }
        state.composerText = remove ? '/ Reaction removed' : `/ Reacted ${emoji}`
        renderMessageCards()
      }
    })
    .catch((error) => {
      console.error(error)
      if (sequence === state.navigationSequence && state.view === 'messages') {
        state.composerText = '/ Reaction failed'
        renderMessageCards()
      }
    })
    .finally(() => { state.busy = false })
}

function handleDoubleClick() {
  if (state.view === 'actions') {
    state.view = 'messages'
    deselectAndShowIdle()
  } else if (state.view === 'messages') {
    showConversationList().catch(console.error)
  } else {
    bridge.shutDownPageContainer(1)
  }
}

function handleExit() {
  bridge.audioControl(false)
  clearInterval(refreshTimer)
  clearInterval(previewTimer)
  unsubscribe()
}

function handleActionsGesture(gesture, event) {
  const index = event.listEvent?.currentSelectItemIndex
  if (Number.isInteger(index) && index >= 0 && index < state.reactionMenuItems.length) {
    state.selectedActionIndex = index
    updateMobileListSelection(index)
  }
  if (gesture === 'click') executeReactionAction(state.reactionMenuItems[state.selectedActionIndex])
}

function handleConversationsGesture(gesture) {
  if (gesture === 'scrollUp') {
    state.selectedConversationIndex = Math.max(state.selectedConversationIndex - 1, 0)
    renderConversationCards().catch(console.error)
    return
  }

  if (gesture === 'scrollDown') {
    state.selectedConversationIndex = Math.min(state.selectedConversationIndex + 1, state.conversations.length - 1)
    renderConversationCards().catch(console.error)
    if (state.selectedConversationIndex >= state.conversations.length - 2) loadMoreConversations()
    return
  }

  if (gesture === 'click') {
    openConversation(state.selectedConversationIndex).catch(console.error)
  }
}

function confirmPendingDraft() {
  state.busy = true
  const draftId = state.pendingDraft.draftId
  const sequence = state.navigationSequence
  state.pendingDraft = null
  client.confirmReply(draftId)
    .then((result) => {
      if (sequence === state.navigationSequence && state.view === 'messages') {
        state.optimisticMessages.unshift(result.message)
        state.optimisticConversationMessages.set(state.activeConversation.id, result.message)
        state.messages = mergeOptimisticMessages(state.messages)
        state.activeConversation.latestMessage = result.message.body
        state.activeConversation.timestamp = result.message.timestamp
        state.selectedMessageIndex = Math.max(state.messages.length - 1, 0)
        resetReplyFlow()
        state.composerText = '/ Message sent'
        renderMessageCards()
      }
    })
    .catch((error) => {
      console.error(error)
      if (sequence === state.navigationSequence && state.view === 'messages') {
        render(threadStatus('Reply not sent', replyFailureDetail))
      }
    })
    .finally(() => { state.busy = false })
}

function beginLongPress() {
  if (state.messageSelected && reactions) {
    renderReactionsMenu()
    return
  }

  state.replyToMessage = quotedReplies ? state.messages[state.selectedMessageIndex] : null
  state.replyMode = true
  startDictation().catch((error) => {
    console.error(error)
    state.recording = false
    state.composerText = '/ Microphone unavailable'
    renderMessageCards()
  })
}

function endLongPress() {
  finishDictation().catch((error) => {
    console.error(error)
    state.recording = false
    state.busy = false
    bridge.audioControl(false)
    state.composerText = '/ Dictation failed · Hold to try again'
    renderMessageCards()
  })
}

function handleMessagesGesture(gesture) {
  if (!state.activeConversation) return

  if (state.pendingDraft) {
    if (gesture === 'scrollUp' || gesture === 'scrollDown') {
      resetReplyFlow()
      showIdleComposer()
    } else if (gesture === 'click' && !state.busy) {
      confirmPendingDraft()
    }
    return
  }

  if (gesture === 'longPress' && !state.recording && !state.busy && state.messages.length > 0) {
    beginLongPress()
    return
  }

  if (gesture === 'longPressRelease' && state.recording && !state.busy) {
    endLongPress()
    return
  }

  if (state.recording || state.busy || state.messages.length === 0) return

  if (state.messageSelected) {
    if (gesture === 'scrollUp' || gesture === 'scrollDown') {
      const message = state.messages[state.selectedMessageIndex]
      const page = readerPageInfo(message, state.readerLineOffset, measureDisplayText)
      const delta = gesture === 'scrollDown' ? page.pageStep : -page.pageStep
      const nextOffset = Math.min(Math.max(page.offset + delta, 0), page.maxOffset)
      if (nextOffset !== state.readerLineOffset) {
        state.readerLineOffset = nextOffset
        renderMessageCards()
      }
      return
    }
    if (gesture === 'click') {
      deselectAndShowIdle()
      return
    }
  }

  if (gesture === 'scrollUp') {
    state.selectedMessageIndex = Math.max(state.selectedMessageIndex - 1, 0)
    deselectAndShowIdle()
    if (state.selectedMessageIndex <= 1) loadOlderMessages()
    return
  }

  if (gesture === 'scrollDown') {
    state.selectedMessageIndex = Math.min(state.selectedMessageIndex + 1, state.messages.length)
    deselectAndShowIdle()
    return
  }

  if (gesture === 'click' && state.selectedMessageIndex < state.messages.length) {
    state.messageSelected = true
    state.readerLineOffset = 0
    state.composerText = reactions ? '/ Hold for reactions' : '/ Hold to reply'
    renderMessageCards()
  }
}

const VIEW_GESTURE_HANDLERS = {
  actions: handleActionsGesture,
  conversations: handleConversationsGesture,
  messages: handleMessagesGesture,
}

const unsubscribe = bridge.onEvenHubEvent((event) => {
  const pcm = event.audioEvent?.audioPcm
  if (state.recording && pcm && state.recordingBytes + pcm.length <= MAX_RECORDING_BYTES) {
    state.recordingChunks.push(pcm)
    state.recordingBytes += pcm.length
  }

  const gesture = gestureFromEvent(event)
  if (gesture === 'doubleClick') {
    handleDoubleClick()
    return
  }

  const exitType = event.sysEvent?.eventType
  if (exitType === OsEventTypeList.SYSTEM_EXIT_EVENT || exitType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    handleExit()
    return
  }

  VIEW_GESTURE_HANDLERS[state.view]?.(gesture, event)
})

initializeMobileCompanion({
  appId,
  bridge,
  settings: bridgeSettings,
  onSave: async () => {
    state.navigationSequence += 1
    client = undefined
    await loadConversations()
  },
})
await loadConversations().catch(() => {})
refreshTimer = setInterval(() => refreshCurrentView().catch(console.error), REFRESH_INTERVAL_MS)
}
