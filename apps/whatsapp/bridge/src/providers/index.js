import { mockProvider } from './mock.js'
import { createWhatsAppProvider } from './whatsapp.js'

export async function createProvider({ name }) {
  switch (name) {
    case 'whatsapp':
      return createWhatsAppProvider()
    case 'mock':
      return mockProvider
    default:
      throw new Error(`Unknown MESSAGING_PROVIDER: ${name}`)
  }
}
