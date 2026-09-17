import { createGurkProvider } from './gurk.js'
import { mockProvider } from './mock.js'

export function createProvider({ name }) {
  switch (name) {
    case 'gurk':
      return createGurkProvider()
    case 'mock':
      return mockProvider
    default:
      throw new Error(`Unknown SIGNAL_PROVIDER: ${name}`)
  }
}
