import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceDirectory = dirname(fileURLToPath(import.meta.url))
const transcriptionScript = join(sourceDirectory, 'transcribe.py')
const workspacePython = join(process.cwd(), '.venv', 'bin', 'python')

export function runWhisperProcess({
  pcm,
  python = process.env.WHISPER_PYTHON ?? (existsSync(workspacePython) ? workspacePython : 'python3'),
  model = process.env.WHISPER_MODEL ?? 'base',
  language = process.env.WHISPER_LANGUAGE,
  timeoutMs = 120_000,
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [transcriptionScript], {
      env: {
        ...process.env,
        WHISPER_MODEL: model,
        ...(language ? { WHISPER_LANGUAGE: language } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Voice transcription timed out'))
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`Voice transcription failed: ${stderr.trim()}`))
        return
      }
      resolve(stdout.trim())
    })
    child.stdin.end(pcm)
  })
}

export function createWhisperTranscriber({ run = runWhisperProcess } = {}) {
  return {
    async transcribe(pcm) {
      return (await run({ pcm })).trim()
    },
  }
}
