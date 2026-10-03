import { execFile } from 'node:child_process'

const MAX_BUFFER = 16 * 1024 * 1024

function timestamp(value) {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function emailText(value = '') {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+] |\d+\. )\s*/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function runHey(args, {
  account = process.env.HEY_ACCOUNT,
  executable = process.env.HEY_PATH ?? 'hey',
  execFileImpl = execFile,
} = {}) {
  const commandArgs = account ? ['--account', account, ...args] : args
  return new Promise((resolve, reject) => {
    execFileImpl(executable, commandArgs, { maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`HEY command failed: ${stderr.trim() || error.message}`))
        return
      }
      resolve(stdout)
    })
  })
}

export function createHeyProvider({
  account = process.env.HEY_ACCOUNT,
  box = process.env.HEY_BOX ?? 'imbox',
  run = runHey,
} = {}) {
  let connectionState = 'connecting'
  let connectionDetail = null
  const options = { account }
  const knownTopics = new Map()
  const execute = async (args) => run(args, options)
  const read = async (args) => {
    const envelope = JSON.parse(await execute([...args, '--json']))
    if (!envelope.ok) throw new Error(envelope.error ?? 'HEY command failed')
    return envelope.data
  }

  // Probe HEY CLI availability in the background.
  execute(['auth', 'status', '--json'])
    .then(() => { connectionState = 'open' })
    .catch((error) => {
      const msg = error?.message ?? ''
      if (/ENOENT/i.test(msg)) {
        connectionState = 'unavailable'
        connectionDetail = 'HEY CLI not installed. See github.com/basecamp/hey-cli'
      } else if (/unauthorized|auth|login|sign.?in|credentials/i.test(msg)) {
        connectionState = 'unavailable'
        connectionDetail = 'HEY CLI not authenticated. Run: hey login'
      } else {
        connectionState = 'unavailable'
        connectionDetail = `HEY CLI error: ${msg || 'unknown'}`
      }
      console.error(`HEY probe failed: ${connectionDetail}`)
    })

  return {
    name: 'hey',
    status() { return connectionState },
    statusDetail() { return connectionDetail },

    async recentConversations(cursor) {
      const data = await read(['box', 'view', box, ...(cursor ? ['--page', cursor] : [])])
      const items = (data.postings ?? [])
        .filter((posting) => posting.topic_id)
        .map((posting) => {
          const id = String(posting.topic_id)
          knownTopics.set(id, posting.name)
          return {
            id,
            title: posting.seen ? posting.name : `* ${posting.name}`,
            latestMessage: emailText(posting.summary),
            timestamp: timestamp(posting.active_at ?? posting.observed_at ?? posting.updated_at),
            unread: !posting.seen,
            reactions: [],
          }
        })
      return {
        items,
        nextCursor: typeof data.next_page === 'string' ? data.next_page : null,
        hasMore: typeof data.next_page === 'string' && data.next_page.length > 0,
      }
    },

    async recentMessages(conversationId) {
      if (!/^\d+$/.test(conversationId)) return null
      try {
        const entries = await read(['thread', 'read', conversationId])
        knownTopics.set(conversationId, knownTopics.get(conversationId) ?? `Thread ${conversationId}`)
        return {
          items: entries.map((entry) => ({
          id: String(entry.id),
          conversationId,
          sender: entry.creator?.contactable_type === 'User' ? 'You' : (entry.creator?.name ?? entry.alternative_sender_name ?? 'Unknown sender'),
          senderId: String(entry.creator?.id ?? ''),
          timestamp: timestamp(entry.created_at ?? entry.updated_at),
          body: emailText(entry.body ?? entry.summary),
          reactions: [],
          })),
          nextCursor: null,
          hasMore: false,
        }
      } catch (error) {
        if (/not[_ ]found|404/i.test(error.message)) return null
        throw error
      }
    },

    async resolveReplyTarget(conversationId) {
      if (!/^\d+$/.test(conversationId)) return null
      if (!knownTopics.has(conversationId)) await this.recentMessages(conversationId)
      return knownTopics.has(conversationId)
        ? { type: 'hey', topicId: conversationId, label: knownTopics.get(conversationId) }
        : null
    },

    async send(target, message) {
      await execute(['reply', target.topicId, '-m', message, '--json'])
      return { timestamp: Date.now() }
    },
  }
}
