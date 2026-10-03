import {
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { startGlintPlugin } from '@glint/g2-plugin'
import { gestureFromEvent } from '@glint/g2-plugin/gestures'
import '@glint/g2-plugin/styles.css'
import './styles.css'

const APP_ID = 'glint'
const MAX_CONTAINERS = 8

// -----------------------------------------------------------------------
// Provider definitions — capabilities and display strings for each
// -----------------------------------------------------------------------
const PROVIDER_CONFIGS = {
  signal: {
    appName: 'Signal',
    displayName: 'Glint Signal',
    logSlug: 'glint-signal',
    emptyStateTitle: 'No conversations',
    emptyStateDetail: 'The bridge returned no Signal conversations.',
    replyFailureDetail: 'The draft expired or Signal was unavailable.',
  },
  whatsapp: {
    appName: 'WhatsApp',
    displayName: 'Glint WhatsApp',
    logSlug: 'glint-whatsapp',
    emptyStateTitle: 'No conversations',
    emptyStateDetail: 'The bridge returned no WhatsApp conversations.',
    replyFailureDetail: 'The draft expired or WhatsApp was unavailable.',
  },
  hey: {
    appName: 'HEY',
    displayName: 'Glint HEY',
    logSlug: 'glint-hey',
    emptyStateTitle: 'No email',
    emptyStateDetail: 'The bridge returned no replyable Imbox threads.',
    replyFailureDetail: 'The draft expired or HEY was unavailable.',
  },
}

// -----------------------------------------------------------------------
// Even Hub bridge and local storage helpers
// -----------------------------------------------------------------------
const bridge = await waitForEvenAppBridge()

async function readStorage(key) {
  try {
    const value = await bridge.getLocalStorage(key)
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  } catch {
    return undefined
  }
}

const storedBaseUrl = await readStorage(`${APP_ID}.base-url`)
const storedToken = await readStorage(`${APP_ID}.bridge-token`)
const storedProvider = await readStorage(`${APP_ID}.provider`)

let baseUrl = storedBaseUrl
  ?? import.meta.env.VITE_BRIDGE_URL
  ?? (import.meta.env.DEV ? 'http://127.0.0.1:8786' : undefined)
let token = storedToken
  ?? import.meta.env.VITE_BRIDGE_TOKEN
  ?? (import.meta.env.DEV ? 'glint-dev' : undefined)

// -----------------------------------------------------------------------
// Glasses display helpers
// -----------------------------------------------------------------------
function statusContainer(content) {
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

const placeholders = Array.from({ length: MAX_CONTAINERS - 1 }, (_, index) =>
  new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 1,
    height: 1,
    borderWidth: 0,
    paddingLength: 0,
    containerID: 90 + index,
    containerName: `ph-${index}`,
    content: '',
    isEventCapture: 0,
    zOrderIndex: 90 + index,
  }),
)

await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: MAX_CONTAINERS,
    textObject: [statusContainer('Glint\n\nLoading...'), ...placeholders],
  }),
)

async function showStatus(text) {
  await bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: 1,
      textObject: [statusContainer(text)],
    }),
  )
}

// -----------------------------------------------------------------------
// Mobile companion badge
// -----------------------------------------------------------------------
function setBadge(label, kind = '') {
  const badge = document.querySelector('#connection-badge')
  if (!badge) return
  badge.textContent = label
  badge.dataset.kind = kind
}

// -----------------------------------------------------------------------
// Provider discovery
// -----------------------------------------------------------------------
async function fetchProviders() {
  if (!baseUrl) return null
  try {
    const response = await fetch(`${baseUrl}/providers`, { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return (await response.json()).providers
  } catch (error) {
    console.error('Failed to fetch providers:', error)
    return null
  }
}

// -----------------------------------------------------------------------
// Provider status helpers
// -----------------------------------------------------------------------
const LAUNCHABLE_STATUSES = new Set(['ok', 'connecting', 'reconnecting'])

function isLaunchable(provider) {
  return LAUNCHABLE_STATUSES.has(provider.status)
}

function providerPickerLabel(provider) {
  if (isLaunchable(provider)) return provider.name
  if (provider.status === 'error') return `${provider.name} — setup error`
  if (provider.status === 'unavailable') return `${provider.name} — not installed`
  if (provider.status === 'logged_out') return `${provider.name} — logged out`
  if (provider.status === 'disconnected') return `${provider.name} — offline`
  return `${provider.name} — ${provider.status}`
}

// -----------------------------------------------------------------------
// Mobile companion — provider status cards
// -----------------------------------------------------------------------
function renderProviderStatusCards(providers) {
  const panel = document.querySelector('#provider-status-panel')
  const list = document.querySelector('#provider-status-list')
  if (!panel || !list) return

  const hasIssues = providers.some((p) => !isLaunchable(p))
  if (!hasIssues) {
    panel.hidden = true
    return
  }

  panel.hidden = false
  list.innerHTML = providers
    .filter((p) => !isLaunchable(p))
    .map((p) => {
      const detail = p.detail ?? `${p.name} is ${p.status}.`
      return `<div class="provider-status-card" data-status="${p.status}">
        <strong>${p.name}</strong>
        <span class="provider-status-badge">${p.status}</span>
        <p class="provider-status-detail">${detail}</p>
      </div>`
    })
    .join('')
}

// -----------------------------------------------------------------------
// Launch a selected provider via startGlintPlugin
// -----------------------------------------------------------------------
async function launchProvider(providerId, capabilities) {
  const config = PROVIDER_CONFIGS[providerId]
  if (!config) {
    await showStatus('Glint\n\nUnknown provider.\n\nDouble-press to exit')
    return
  }

  setBadge(config.appName, 'success')

  await startGlintPlugin({
    appId: `${APP_ID}-session`,
    appName: config.appName,
    displayName: config.displayName,
    logSlug: config.logSlug,
    bridgeUrl: `${baseUrl}/${providerId}`,
    bridgeToken: token,
    emptyStateTitle: config.emptyStateTitle,
    emptyStateDetail: config.emptyStateDetail,
    replyFailureDetail: config.replyFailureDetail,
    capabilities: capabilities ?? {},
    onBack: () => {
      setBadge('Selecting...')
      showProviderPicker(providers)
      runProviderPicker(providers)
    },
  })
}

// -----------------------------------------------------------------------
// Glasses-side provider picker
// -----------------------------------------------------------------------
function showProviderPicker(providers) {
  const title = new TextContainerProperty({
    xPosition: 8,
    yPosition: 4,
    width: 560,
    height: 48,
    borderWidth: 0,
    paddingLength: 6,
    containerID: 30,
    containerName: 'picker-title',
    content: 'Glint — Select a provider',
    isEventCapture: 0,
    zOrderIndex: 0,
  })
  const list = new ListContainerProperty({
    xPosition: 8,
    yPosition: 60,
    width: 560,
    height: 220,
    borderWidth: 0,
    paddingLength: 6,
    containerID: 31,
    containerName: 'picker-list',
    itemContainer: new ListItemContainerProperty({
      itemCount: providers.length,
      itemWidth: 548,
      isItemSelectBorderEn: 1,
      itemName: providers.map((p) => providerPickerLabel(p)),
    }),
    isEventCapture: 1,
    zOrderIndex: 1,
  })
  bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: 2,
      textObject: [title],
      listObject: [list],
    }),
  ).catch(console.error)
}

function runProviderPicker(providers) {
  let selectedIndex = 0
  showProviderPicker(providers)

  const unsubscribe = bridge.onEvenHubEvent((event) => {
    const exitType = event.sysEvent?.eventType
    if (exitType === OsEventTypeList.SYSTEM_EXIT_EVENT || exitType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
      unsubscribe()
      return
    }

    const gesture = gestureFromEvent(event)

    if (gesture === 'doubleClick') {
      unsubscribe()
      bridge.shutDownPageContainer(1)
      return
    }

    const index = event.listEvent?.currentSelectItemIndex
    if (Number.isInteger(index) && index >= 0 && index < providers.length) {
      selectedIndex = index
      setBadge(providers[selectedIndex].name)
    }

    if (gesture === 'click') {
      const selected = providers[selectedIndex]
      if (!isLaunchable(selected)) {
        const detail = selected.detail ?? `${selected.name} is not available.`
        showStatus(`${selected.name}\n\n${detail}\n\nPress to go back`).catch(console.error)
        setBadge(`${selected.name}: ${selected.status}`, 'error')
        const detailUnsub = bridge.onEvenHubEvent((detailEvent) => {
          const detailGesture = gestureFromEvent(detailEvent)
          if (detailGesture === 'click' || detailGesture === 'doubleClick') {
            detailUnsub()
            setBadge('Selecting...')
            showProviderPicker(providers)
            runProviderPicker(providers)
          }
        })
        unsubscribe()
        return
      }
      unsubscribe()
      bridge.setLocalStorage(`${APP_ID}.provider`, selected.id).catch(console.error)
      launchProvider(selected.id, selected.capabilities).catch(console.error)
    }
  })
}

// -----------------------------------------------------------------------
// Mobile companion — settings form
// -----------------------------------------------------------------------
function initMobileCompanion() {
  const form = document.querySelector('#unified-settings')
  const urlInput = document.querySelector('#base-url')
  const tokenInput = document.querySelector('#base-token')
  const status = document.querySelector('#unified-status')

  if (urlInput) urlInput.value = baseUrl ?? ''
  if (!form) return

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    let url
    try {
      const parsed = new URL(urlInput.value.trim())
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Use HTTP or HTTPS.')
      url = parsed.href.replace(/\/$/, '')
    } catch (error) {
      status.textContent = error.message || 'Enter a valid URL.'
      status.dataset.kind = 'error'
      return
    }

    const newToken = tokenInput.value.trim() || token
    if (!newToken) {
      status.textContent = 'Enter a bridge token.'
      status.dataset.kind = 'error'
      return
    }

    status.textContent = 'Saving...'
    status.dataset.kind = ''

    try {
      await Promise.all([
        bridge.setLocalStorage(`${APP_ID}.base-url`, url),
        bridge.setLocalStorage(`${APP_ID}.bridge-token`, newToken),
      ])
      baseUrl = url
      token = newToken
      tokenInput.value = ''

      status.textContent = 'Saved.'
      status.dataset.kind = 'success'
    } catch (error) {
      console.error(error)
      status.textContent = error.message
      status.dataset.kind = 'error'
    }
  })
}

// -----------------------------------------------------------------------
// Main flow
// -----------------------------------------------------------------------
const providers = await fetchProviders()

if (!providers) {
  if (!baseUrl || !token) {
    setBadge('Setup required', 'error')
    await showStatus('Glint\n\nConfigure the bridge on your phone.\n\nDouble-press to exit')
  } else {
    setBadge('Unavailable', 'error')
    await showStatus('Glint\n\nBridge unavailable.\nCheck the URL and Tailscale.\n\nDouble-press to exit')
  }
  initMobileCompanion()
  bridge.onEvenHubEvent((event) => {
    if (gestureFromEvent(event) === 'doubleClick') bridge.shutDownPageContainer(1)
  })
} else if (storedProvider && providers.some((p) => p.id === storedProvider && isLaunchable(p))) {
  // Stored provider is available — launch it directly
  initMobileCompanion()
  renderProviderStatusCards(providers)
  const provider = providers.find((p) => p.id === storedProvider)
  await launchProvider(storedProvider, provider.capabilities)
} else {
  // No stored provider or it's unavailable — show the picker
  setBadge('Selecting...')
  initMobileCompanion()
  renderProviderStatusCards(providers)
  runProviderPicker(providers)
}
