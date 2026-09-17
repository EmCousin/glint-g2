function compareDescending(left, right) {
  return right.timestamp - left.timestamp || right.id.localeCompare(left.id)
}

function encodeCursor(item) {
  return Buffer.from(JSON.stringify([item.timestamp, item.id])).toString('base64url')
}

function decodeCursor(cursor) {
  if (cursor == null) return null
  if (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    const error = new TypeError('Invalid cursor')
    error.code = 'INVALID_CURSOR'
    throw error
  }

  try {
    const [timestamp, id, ...extra] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (!Number.isFinite(timestamp) || typeof id !== 'string' || extra.length > 0) throw new Error()
    return { timestamp, id }
  } catch {
    const error = new TypeError('Invalid cursor')
    error.code = 'INVALID_CURSOR'
    throw error
  }
}

export function paginateByTimestamp(items, limit, cursor) {
  const key = decodeCursor(cursor)
  const candidates = [...items]
    .sort(compareDescending)
    .filter((item) => !key || compareDescending(item, key) > 0)
    .slice(0, limit + 1)
  const hasMore = candidates.length > limit
  const page = candidates.slice(0, limit)

  return {
    items: page,
    nextCursor: hasMore ? encodeCursor(page.at(-1)) : null,
    hasMore,
  }
}
