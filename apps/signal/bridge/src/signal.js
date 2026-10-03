import net from 'node:net'
import { randomUUID } from 'node:crypto'

export function signalEnvelopeFromNotification(notification) {
  if (notification?.method !== 'receive') return null
  const payload = notification.params?.result ?? notification.params
  return payload?.envelope ? { account: payload.account, envelope: payload.envelope } : null
}

export function subscribeSignalMessages({
  onEnvelope,
  socketPath = process.env.SIGNAL_SOCKET ?? `/run/user/${process.getuid()}/signal-cli/socket`,
  connect = net.createConnection,
  retryMs = 1_000,
} = {}) {
  let socket
  let stopped = false
  let retryTimer

  function open() {
    if (stopped) return
    let buffer = ''
    socket = connect(socketPath)
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      buffer += chunk
      while (buffer.includes('\n')) {
        const newline = buffer.indexOf('\n')
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        try {
          const received = signalEnvelopeFromNotification(JSON.parse(line))
          if (received) onEnvelope(received)
        } catch (error) {
          console.error('Invalid signal-cli notification:', error)
        }
      }
    })
    socket.on('error', (error) => {
      console.error('Signal receive socket error:', error)
    })
    socket.on('close', () => {
      if (!stopped) retryTimer = setTimeout(open, retryMs)
    })
  }

  open()
  return () => {
    stopped = true
    clearTimeout(retryTimer)
    socket?.destroy()
  }
}

export function signalRequest(method, params = {}, {
  socketPath = process.env.SIGNAL_SOCKET ?? `/run/user/${process.getuid()}/signal-cli/socket`,
  timeoutMs = 10_000,
} = {}) {
  return new Promise((resolve, reject) => {
    const id = randomUUID()
    const socket = net.createConnection(socketPath)
    let buffer = ''
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`Signal request timed out: ${method}`))
    }, timeoutMs)

    socket.setEncoding('utf8')
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
    socket.on('data', (chunk) => {
      buffer += chunk
      while (buffer.includes('\n')) {
        const newline = buffer.indexOf('\n')
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue

        let response
        try {
          response = JSON.parse(line)
        } catch {
          continue
        }
        if (response.id !== id) continue

        clearTimeout(timer)
        socket.end()
        if (response.error) reject(new Error(response.error.message ?? 'Signal JSON-RPC error'))
        else resolve(response.result)
        return
      }
    })
    socket.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

export function createSignalSender({
  account = process.env.SIGNAL_ACCOUNT,
  request = signalRequest,
} = {}) {
  let connectionState = 'connecting'
  let connectionDetail = null

  // Probe signal-cli availability in the background.
  request('listAccounts')
    .then(() => { connectionState = 'open' })
    .catch((error) => {
      connectionState = 'disconnected'
      const msg = error?.message ?? ''
      if (/ENOENT|ECONNREFUSED|EACCES/i.test(msg)) {
        connectionDetail = 'signal-cli socket not found. Start the daemon:\nsignal-cli -a +NUMBER daemon --socket'
      } else if (/timed? ?out/i.test(msg)) {
        connectionDetail = 'signal-cli is not responding. Restart the daemon and check the SIGNAL_SOCKET path.'
      } else {
        connectionDetail = `signal-cli error: ${msg || 'unknown'}`
      }
      console.error(`Signal probe failed: ${connectionDetail}`)
    })

  async function resolveAccount() {
    if (account) return account
    const accounts = await request('listAccounts')
    if (accounts.length !== 1) {
      throw new Error('Set SIGNAL_ACCOUNT when signal-cli has zero or multiple linked accounts')
    }
    return accounts[0].number
  }

  async function resolveContactNumber(selectedAccount, uuid, allowUsername = false, knownContacts = null) {
    const contacts = knownContacts ?? await request('listContacts', { account: selectedAccount })
    const contact = contacts.find((candidate) => candidate.uuid?.toLowerCase() === uuid)
    if (contact?.number) return contact.number
    if (allowUsername && contact?.username) return `u:${contact.username}`

    const accounts = await request('listAccounts')
    const ownAccount = accounts.find((candidate) => (
      candidate.number === selectedAccount && candidate.uuid?.toLowerCase() === uuid
    ))
    if (ownAccount) return ownAccount.number
    throw new Error('Signal message author is not available in linked contacts')
  }

  async function addDestination(params, target, selectedAccount, contacts) {
    if (target.type === 'group') {
      params.groupId = target.groupId
      return
    }

    const recipient = await resolveContactNumber(selectedAccount, target.recipientUuid, true, contacts)
    params.recipient = [recipient]
  }

  return {
    status() { return connectionState },
    statusDetail() { return connectionDetail },
    async send(target, message, quote = null) {
      const selectedAccount = await resolveAccount()
      const params = { account: selectedAccount, message }
      const contacts = target.type !== 'group' || quote
        ? await request('listContacts', { account: selectedAccount })
        : null
      await addDestination(params, target, selectedAccount, contacts)
      if (quote) {
        params.quoteTimestamp = quote.timestamp
        params.quoteAuthor = await resolveContactNumber(selectedAccount, quote.senderUuid, false, contacts)
        params.quoteMessage = quote.body
      }

      return request('send', params)
    },
    async react(target, message, emoji, remove = false) {
      const selectedAccount = await resolveAccount()
      const contacts = await request('listContacts', { account: selectedAccount })
      const targetAuthor = target.type === 'direct' && message.senderUuid !== target.recipientUuid
        ? selectedAccount
        : await resolveContactNumber(selectedAccount, message.senderUuid, false, contacts)
      const params = {
        account: selectedAccount,
        emoji,
        targetTimestamp: message.timestamp,
        targetAuthor,
      }
      if (remove) params.remove = true
      await addDestination(params, target, selectedAccount, contacts)
      try {
        return await request('sendReaction', params)
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250))
        return request('sendReaction', params)
      }
    },
  }
}
