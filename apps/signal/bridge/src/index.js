import { createWhisperTranscriber } from '@glint/bridge'
import { createApp } from './app.js'
import { createProvider } from './providers/index.js'
import { createSignalSender, subscribeSignalMessages } from './signal.js'

const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 8787)
const token = process.env.BRIDGE_TOKEN ?? (process.env.NODE_ENV === 'production' ? undefined : 'glint-signal-dev')
const provider = createProvider({ name: process.env.SIGNAL_PROVIDER ?? 'mock' })
const sender = provider.name === 'gurk'
  ? createSignalSender()
  : { async send() { return { mock: true } } }
const transcriber = createWhisperTranscriber()

const app = createApp({ token, provider, sender, transcriber })

if (provider.ingestSignalEnvelope) {
  subscribeSignalMessages({ onEnvelope: ({ account, envelope }) => provider.ingestSignalEnvelope(envelope, account) })
}

app.listen(port, host, () => {
  console.log(`Glint Signal bridge listening on http://${host}:${port}`)
  console.log(`Provider: ${provider.name}`)
})
