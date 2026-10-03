import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys'
import pino from 'pino'
import qrcode from 'qrcode-terminal'
import { encodeMessageKey } from './providers/whatsapp.js'

export function createWhatsAppTransport({
  provider,
  authPath = process.env.WHATSAPP_AUTH_DIR ?? './data/whatsapp-auth',
  phoneNumber = process.env.WHATSAPP_PHONE_NUMBER,
  logger = pino({ level: process.env.WHATSAPP_LOG_LEVEL ?? 'warn' }),
  makeSocket = makeWASocket,
  loadAuth = useMultiFileAuthState,
  latestVersion = fetchLatestBaileysVersion,
  cacheKeyStore = makeCacheableSignalKeyStore,
} = {}) {
  let socket
  let stopped = false
  let reconnectTimer
  let pairingRequested = false
  let connectionState = 'disconnected'
  let reconnectAttempts = 0

  function scheduleReconnect(error) {
    if (stopped) return
    if (error) console.error('WhatsApp connection failed:', error)
    connectionState = 'reconnecting'
    clearTimeout(reconnectTimer)
    const delay = Math.min(1_000 * (2 ** reconnectAttempts), 30_000)
    reconnectAttempts += 1
    reconnectTimer = setTimeout(() => connect().catch(scheduleReconnect), delay)
  }

  function requestPairingCode() {
    pairingRequested = true
    socket.requestPairingCode(phoneNumber.replaceAll(/\D/g, ''))
      .then((code) => console.log(`WhatsApp pairing code: ${code}`))
      .catch((error) => {
        pairingRequested = false
        console.error('Could not request WhatsApp pairing code:', error)
      })
  }

  async function connect() {
    connectionState = 'connecting'
    const { state, saveCreds } = await loadAuth(authPath)
    const { version } = await latestVersion()
    socket = makeSocket({
      version,
      auth: {
        creds: state.creds,
        keys: cacheKeyStore(state.keys, logger),
      },
      browser: Browsers.ubuntu('Glint WhatsApp'),
      logger,
      markOnlineOnConnect: false,
      syncFullHistory: true,
      getMessage: async (key) => (await provider.findMessageTarget(key))?.raw?.message,
    })

    socket.ev.on('creds.update', saveCreds)
    socket.ev.on('messaging-history.set', (history) => provider.ingestHistory(history))
    socket.ev.on('messages.upsert', ({ messages }) => provider.ingestMessages(messages))
    socket.ev.on('messages.update', (updates) => provider.ingestMessageUpdates(updates))
    socket.ev.on('messages.delete', (deletion) => provider.deleteMessages(deletion))
    socket.ev.on('messages.reaction', (reactions) => provider.ingestReactions(reactions))
    socket.ev.on('contacts.upsert', (contacts) => provider.ingestContacts(contacts))
    socket.ev.on('contacts.update', (contacts) => provider.ingestContacts(contacts))
    socket.ev.on('chats.upsert', (chats) => provider.ingestChats(chats))
    socket.ev.on('chats.update', (chats) => provider.ingestChats(chats))
    socket.ev.on('chats.delete', (chatIds) => provider.deleteChats(chatIds))
    socket.ev.on('groups.upsert', (groups) => provider.ingestChats(groups))
    socket.ev.on('groups.update', (groups) => provider.ingestChats(groups))
    socket.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        if (phoneNumber && !state.creds.registered && !pairingRequested) {
          requestPairingCode()
        } else if (!phoneNumber) {
          console.log('Scan this QR code from WhatsApp > Linked devices:')
          qrcode.generate(qr, { small: true })
        }
      }
      if (connection === 'open') {
        connectionState = 'open'
        reconnectAttempts = 0
        console.log('WhatsApp linked device connected')
      }
      if (connection !== 'close' || stopped) return

      connectionState = 'disconnected'
      socket = undefined
      const statusCode = lastDisconnect?.error?.output?.statusCode
      if (statusCode === DisconnectReason.loggedOut) {
        connectionState = 'logged_out'
        console.error('WhatsApp logged out. Remove WHATSAPP_AUTH_DIR and pair the bridge again.')
        return
      }
      scheduleReconnect(lastDisconnect?.error)
    })
  }

  return {
    async start() {
      stopped = false
      await connect().catch(scheduleReconnect)
    },
    async stop() {
      stopped = true
      clearTimeout(reconnectTimer)
      socket?.end(undefined)
      await provider.flush()
    },
    async send(target, message, quote = null) {
      if (!socket || connectionState !== 'open') throw new Error('WhatsApp is not connected')
      const sent = await socket.sendMessage(
        target.jid,
        { text: message },
        quote ? { quoted: quote.raw } : undefined,
      )
      provider.ingestMessages([sent])
      return {
        id: encodeMessageKey(sent.key),
        timestamp: Number(sent.messageTimestamp) * 1000,
      }
    },
    async react(target, message, emoji, remove = false) {
      if (!socket || connectionState !== 'open') throw new Error('WhatsApp is not connected')
      await socket.sendMessage(target.jid, {
        react: { text: remove ? '' : emoji, key: message.key },
      })
    },
    status() {
      return connectionState
    },
    statusDetail() {
      switch (connectionState) {
        case 'logged_out':
          return 'WhatsApp session expired. Delete the auth directory and restart the bridge to re-link.'
        case 'disconnected':
          return 'WhatsApp is disconnected. The bridge will retry automatically.'
        case 'connecting':
          return 'Connecting to WhatsApp…'
        case 'reconnecting':
          return 'Reconnecting to WhatsApp…'
        default:
          return null
      }
    },
  }
}
