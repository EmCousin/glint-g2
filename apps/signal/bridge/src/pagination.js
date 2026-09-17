export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid pagination cursor')
    this.name = 'InvalidCursorError'
  }
}

export function encodeCursor(payload) {
  return Buffer.from(JSON.stringify({ version: 1, ...payload })).toString('base64url')
}

export function decodeCursor(cursor) {
  if (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new InvalidCursorError()
  }

  try {
    const decoded = Buffer.from(cursor, 'base64url')
    if (decoded.toString('base64url') !== cursor) throw new InvalidCursorError()
    const payload = JSON.parse(decoded.toString('utf8'))
    if (!payload || payload.version !== 1) throw new InvalidCursorError()
    return payload
  } catch (error) {
    if (error instanceof InvalidCursorError) throw error
    throw new InvalidCursorError()
  }
}
