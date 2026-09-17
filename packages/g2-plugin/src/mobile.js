const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
function storageKeys(appId) {
  return {
    url: `${appId}.bridge-url`,
    token: `${appId}.bridge-token`,
  }
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NAMESPACE, name)
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value)
  return element
}

function appendText(svg, container, content, xOffset = 0, yOffset = 0) {
  const text = svgElement('text', {
    x: container.xPosition + (container.paddingLength ?? 0) + xOffset,
    y: container.yPosition + (container.paddingLength ?? 0) + 23 + yOffset,
    class: container.textColor === 1 ? 'display-text dimmed' : 'display-text',
  })
  String(content ?? '').split('\n').forEach((line, index) => {
    const tspan = svgElement('tspan', {
      x: container.xPosition + (container.paddingLength ?? 0) + xOffset,
      dy: index === 0 ? 0 : 27,
    })
    tspan.textContent = line || ' '
    text.append(tspan)
  })
  svg.append(text)
}

function appendContainer(svg, container) {
  if (container.width <= 1 || container.height <= 1) return
  const borderWidth = container.borderWidth ?? 0
  if (borderWidth > 0) {
    svg.append(svgElement('rect', {
      x: container.xPosition + borderWidth / 2,
      y: container.yPosition + borderWidth / 2,
      width: container.width - borderWidth,
      height: container.height - borderWidth,
      rx: container.borderRadius ?? 0,
      class: 'display-border',
      'stroke-width': borderWidth,
    }))
  }
  appendText(svg, container, container.content)
}

function appendList(svg, container) {
  const items = container.itemContainer?.itemName ?? []
  const itemHeight = Math.max(34, Math.floor(container.height / Math.max(items.length, 1)))
  items.forEach((item, index) => {
    svg.append(svgElement('rect', {
      x: container.xPosition + 2,
      y: container.yPosition + index * itemHeight + 2,
      width: container.width - 4,
      height: itemHeight - 4,
      rx: 5,
      class: index === 0 ? 'display-border display-selection' : 'display-border display-selection hidden',
      'data-list-index': index,
      'stroke-width': 2,
    }))
    appendText(svg, {
      ...container,
      yPosition: container.yPosition + index * itemHeight,
      paddingLength: container.paddingLength ?? 6,
    }, item)
  })
}

export function normalizeBridgeUrl(value) {
  const url = new URL(value.trim())
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS endpoint.')
  return url.href.replace(/\/$/, '')
}

export async function loadBridgeSettings(bridge, appId, defaults) {
  const keys = storageKeys(appId)
  const read = async (key) => {
    try {
      const value = await bridge.getLocalStorage(key)
      return typeof value === 'string' && value.trim() ? value.trim() : undefined
    } catch {
      return undefined
    }
  }
  return {
    url: await read(keys.url) ?? defaults.url,
    token: await read(keys.token) ?? defaults.token,
  }
}

export function initializeMobileCompanion({ appId, bridge, settings, onSave }) {
  const keys = storageKeys(appId)
  const form = document.querySelector('#bridge-settings')
  const urlInput = document.querySelector('#bridge-url')
  const tokenInput = document.querySelector('#bridge-token')
  const status = document.querySelector('#settings-status')
  urlInput.value = settings.url ?? ''

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    let url
    try {
      url = normalizeBridgeUrl(urlInput.value)
    } catch (error) {
      status.textContent = error.message
      status.dataset.kind = 'error'
      return
    }
    const token = tokenInput.value.trim() || settings.token
    if (!token) {
      status.textContent = 'Enter a bridge token.'
      status.dataset.kind = 'error'
      return
    }

    status.textContent = 'Saving and connecting...'
    status.dataset.kind = ''
    try {
      const [urlSaved, tokenSaved] = await Promise.all([
        bridge.setLocalStorage(keys.url, url),
        bridge.setLocalStorage(keys.token, token),
      ])
      if (!urlSaved || !tokenSaved) throw new Error('Even Hub could not save the settings.')
      settings.url = url
      settings.token = token
      urlInput.value = url
      tokenInput.value = ''
      await onSave(settings)
      status.textContent = 'Connected. Settings saved on this phone.'
      status.dataset.kind = 'success'
    } catch (error) {
      status.textContent = error.message
      status.dataset.kind = 'error'
    }
  })
}

export function setMobileConnectionStatus(label, kind = '') {
  const badge = document.querySelector('#connection-badge')
  badge.textContent = label
  badge.dataset.kind = kind
}

export function updateMobileListSelection(index) {
  document.querySelectorAll('[data-list-index]').forEach((item) => {
    item.classList.toggle('hidden', Number(item.dataset.listIndex) !== index)
  })
}

export function renderMobilePage(textContainers = [], listContainers = []) {
  const svg = document.querySelector('#glasses-preview')
  svg.replaceChildren()
  ;[...textContainers, ...listContainers]
    .sort((left, right) => (left.zOrderIndex ?? 0) - (right.zOrderIndex ?? 0))
    .forEach((container) => {
      if (container.itemContainer) appendList(svg, container)
      else appendContainer(svg, container)
    })
}

export function renderMobileStatus(content) {
  renderMobilePage([{
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    paddingLength: 12,
    content,
  }])
}
