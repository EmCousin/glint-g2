import { createWhisperTranscriber } from '@glint/bridge'
import { createApp } from './app.js'
import { createProvider } from './providers/index.js'
import { createWhatsAppTransport } from './whatsapp.js'

process.umask(0o077)

const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 8787)
const token = process.env.BRIDGE_TOKEN ?? (process.env.NODE_ENV === 'production' ? undefined : 'glint-whatsapp-dev')
const provider = await createProvider({ name: process.env.MESSAGING_PROVIDER ?? 'mock' })
const transport = provider.name === 'whatsapp'
  ? createWhatsAppTransport({ provider })
  : {
      async start() {},
      async stop() {},
      async send() { return { mock: true } },
      async react() {},
    }
const transcriber = createWhisperTranscriber()

const app = createApp({ token, provider, sender: transport, transcriber })
await transport.start()

app.listen(port, host, () => {
  console.log(`Glint WhatsApp bridge listening on http://${host}:${port}`)
  console.log(`Provider: ${provider.name}`)
})

async function shutDown() {
  await transport.stop()
  process.exit(0)
}

process.once('SIGINT', shutDown)
process.once('SIGTERM', shutDown)
