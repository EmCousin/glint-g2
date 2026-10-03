import { createWhisperTranscriber, createBridgeApp } from '@glint/bridge'
import express from 'express'
import cors from 'cors'

process.umask(0o077)

const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 8786)
const token = process.env.BRIDGE_TOKEN ?? (process.env.NODE_ENV === 'production' ? undefined : 'glint-dev')
const enabledProviders = (process.env.PROVIDERS ?? 'signal,whatsapp,hey')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const transcriber = createWhisperTranscriber()
const app = express()
app.disable('x-powered-by')
app.use(cors())
app.use((_request, response, next) => {
  response.set('Cache-Control', 'no-store')
  next()
})

const registry = []
const cleanups = []

// ---------------------------------------------------------------------------
// Mount Signal
// ---------------------------------------------------------------------------
if (enabledProviders.includes('signal')) {
  try {
    const { createProvider } = await import('../../../signal/bridge/src/providers/index.js')
    const { createSignalSender, subscribeSignalMessages } = await import('../../../signal/bridge/src/signal.js')
    const providerName = process.env.SIGNAL_PROVIDER ?? 'mock'
    const provider = createProvider({ name: providerName })
    const sender = providerName === 'gurk'
      ? createSignalSender()
      : { async send() { return { mock: true } } }
    const capabilities = { quotedReplies: true, reactions: true, sentMessageIds: false }
    const subApp = createBridgeApp({ token, provider, sender, transcriber, capabilities })

    if (provider.ingestSignalEnvelope) {
      subscribeSignalMessages({
        onEnvelope: ({ account, envelope }) => provider.ingestSignalEnvelope(envelope, account),
      })
    }

    app.use('/signal', subApp)
    registry.push({ id: 'signal', name: 'Signal', capabilities, sender })
    console.log(`Mounted: signal (${providerName})`)
  } catch (error) {
    console.error('Failed to mount signal:', error)
  }
}

// ---------------------------------------------------------------------------
// Mount WhatsApp
// ---------------------------------------------------------------------------
if (enabledProviders.includes('whatsapp')) {
  try {
    const { createProvider } = await import('../../../whatsapp/bridge/src/providers/index.js')
    const { createWhatsAppTransport } = await import('../../../whatsapp/bridge/src/whatsapp.js')
    const providerName = process.env.MESSAGING_PROVIDER ?? 'mock'
    const provider = await createProvider({ name: providerName })
    const transport = providerName === 'whatsapp'
      ? createWhatsAppTransport({ provider })
      : {
          async start() {},
          async stop() {},
          async send() { return { mock: true } },
          async react() {},
        }
    const capabilities = { quotedReplies: true, reactions: true, sentMessageIds: true }
    const subApp = createBridgeApp({ token, provider, sender: transport, transcriber, capabilities })

    await transport.start()
    cleanups.push(() => transport.stop())
    app.use('/whatsapp', subApp)
    registry.push({ id: 'whatsapp', name: 'WhatsApp', capabilities, sender: transport })
    console.log(`Mounted: whatsapp (${providerName})`)
  } catch (error) {
    console.error('Failed to mount whatsapp:', error)
  }
}

// ---------------------------------------------------------------------------
// Mount HEY
// ---------------------------------------------------------------------------
if (enabledProviders.includes('hey')) {
  try {
    const { createProvider } = await import('../../../hey/bridge/src/providers/index.js')
    const providerName = process.env.HEY_PROVIDER ?? 'mock'
    const provider = createProvider({ name: providerName })
    const sender = provider.send ? provider : { async send() { return { mock: true } } }
    const capabilities = { quotedReplies: false, reactions: false, sentMessageIds: false }
    const subApp = createBridgeApp({ token, provider, sender, transcriber, capabilities })

    app.use('/hey', subApp)
    registry.push({ id: 'hey', name: 'HEY', capabilities, sender })
    console.log(`Mounted: hey (${providerName})`)
  } catch (error) {
    console.error('Failed to mount hey:', error)
  }
}

// ---------------------------------------------------------------------------
// Provider discovery
// ---------------------------------------------------------------------------
app.get('/providers', (_request, response) => {
  response.json({
    providers: registry.map(({ id, name, capabilities, sender }) => {
      const connection = sender.status?.()
      return {
        id,
        name,
        status: connection && connection !== 'open' ? connection : 'ok',
        capabilities: {
          reactions: capabilities.reactions,
          quotedReplies: capabilities.quotedReplies,
        },
      }
    }),
  })
})

app.get('/health', (_request, response) => {
  response.json({ status: 'ok', providers: registry.map((entry) => entry.id) })
})

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(port, host, () => {
  console.log(`Glint unified bridge listening on http://${host}:${port}`)
  console.log(`Providers: ${registry.map((entry) => entry.id).join(', ') || 'none'}`)
})

async function shutDown() {
  await Promise.allSettled(cleanups.map((fn) => fn()))
  process.exit(0)
}

process.once('SIGINT', shutDown)
process.once('SIGTERM', shutDown)
