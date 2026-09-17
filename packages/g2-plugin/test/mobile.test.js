import assert from 'node:assert/strict'
import test from 'node:test'
import { loadBridgeSettings, normalizeBridgeUrl } from '../src/mobile.js'

test('normalizeBridgeUrl trims input and removes a trailing slash', () => {
  assert.equal(normalizeBridgeUrl(' https://bridge.example.test/ '), 'https://bridge.example.test')
})

test('normalizeBridgeUrl rejects non-HTTP protocols', () => {
  assert.throws(() => normalizeBridgeUrl('file:///tmp/bridge'), /HTTP or HTTPS/)
})

test('loadBridgeSettings prefers persisted values and falls back independently', async () => {
  const keys = []
  const bridge = {
    async getLocalStorage(key) {
      keys.push(key)
      return key.endsWith('bridge-url') ? 'https://saved.example.test' : ''
    },
  }

  assert.deepEqual(await loadBridgeSettings(bridge, 'glint-signal', {
    url: 'https://default.example.test',
    token: 'default-token',
  }), {
    url: 'https://saved.example.test',
    token: 'default-token',
  })
  assert.deepEqual(keys, ['glint-signal.bridge-url', 'glint-signal.bridge-token'])
})
