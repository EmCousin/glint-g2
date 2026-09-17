import { createHeyProvider } from './hey.js'
import { mockProvider } from './mock.js'

export function createProvider({ name }) {
  switch (name) {
    case 'hey':
      return createHeyProvider()
    case 'mock':
      return mockProvider
    default:
      throw new Error(`Unknown HEY_PROVIDER: ${name}`)
  }
}
