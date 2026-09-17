import { createWhisperTranscriber } from '@glint/bridge'
import { createApp } from './app.js'
import { createProvider } from './providers/index.js'

const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 8789)
const token = process.env.BRIDGE_TOKEN ?? (process.env.NODE_ENV === 'production' ? undefined : 'glint-hey-dev')
const provider = createProvider({ name: process.env.HEY_PROVIDER ?? 'mock' })
const sender = provider.send ? provider : { async send() { return { mock: true } } }
const transcriber = createWhisperTranscriber()

const app = createApp({ token, provider, sender, transcriber })

app.listen(port, host, () => {
  console.log(`Glint HEY bridge listening on http://${host}:${port}`)
  console.log(`Provider: ${provider.name}`)
})
