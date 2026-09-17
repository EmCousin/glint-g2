export function createBridgeClient({ baseUrl, token, fetchImpl = fetch }) {
  const paginatedPath = (path, cursor) => cursor
    ? `${path}?${new URLSearchParams({ cursor })}`
    : path
  const request = async (path, options = {}) => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...options,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    if (!response.ok) {
      throw new Error(`Bridge request failed (${response.status})`)
    }

    return response.json()
  }

  return {
    health: () => request('/health'),
    recentConversations: (cursor) => request(paginatedPath('/api/conversations', cursor)),
    recentMessages: (conversationId, cursor) => request(paginatedPath(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, cursor)),
    createReplyDraft: (conversationId, message, messageId) => request('/api/replies/drafts', {
      method: 'POST',
      body: JSON.stringify({ conversationId, message, messageId }),
    }),
    dictateReply: (conversationId, pcm, messageId) => request('/api/replies/dictate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Conversation-Id': conversationId,
        ...(messageId ? { 'X-Message-Id': messageId } : {}),
      },
      body: pcm,
    }),
    previewDictation: (pcm) => request('/api/replies/dictate/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: pcm,
    }),
    confirmReply: (draftId) => request(`/api/replies/${encodeURIComponent(draftId)}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ confirm: true }),
    }),
    react: (conversationId, messageId, emoji, remove = false) => request('/api/reactions', {
      method: 'POST',
      body: JSON.stringify({ conversationId, messageId, emoji, remove }),
    }),
    // Diagnostic only: pushes text into the bridge's own log, since copying
    // multi-line text off the glasses' screen isn't practical.
    debugLog: (message) => request('/api/debug-log', {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
  }
}
