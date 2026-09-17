import assert from 'node:assert/strict'
import test from 'node:test'
import { createWhisperTranscriber } from '../src/transcriber.js'

test('Whisper transcriber passes PCM to the backend and trims its transcript', async () => {
  const pcm = Buffer.from([1, 2, 3, 4])
  let received
  const transcriber = createWhisperTranscriber({
    run: async (options) => {
      received = options.pcm
      return '  Hello from G2  '
    },
  })

  assert.equal(await transcriber.transcribe(pcm), 'Hello from G2')
  assert.equal(received, pcm)
})
