import assert from 'node:assert/strict'
import test from 'node:test'
import { createHeyProvider, emailText, runHey } from '../src/providers/hey.js'

function envelope(data) {
  return JSON.stringify({ ok: true, data })
}

test('emailText turns common Markdown email content into display text', () => {
  assert.equal(
    emailText('# Update\n\nSee [the report](https://example.com).\n\n- **Approved**'),
    'Update See the report. Approved',
  )
})

test('runHey passes account selection and arguments without a shell', async () => {
  let invocation
  const output = await runHey(['box', 'view', 'imbox', '--json'], {
    account: 'work',
    executable: '/usr/bin/hey',
    execFileImpl(command, args, options, callback) {
      invocation = { command, args, options }
      callback(null, '{}', '')
    },
  })

  assert.equal(output, '{}')
  assert.equal(invocation.command, '/usr/bin/hey')
  assert.deepEqual(invocation.args, ['--account', 'work', 'box', 'view', 'imbox', '--json'])
  assert.ok(invocation.options.maxBuffer > 1_000_000)
})

test('HEY provider maps replyable Imbox postings and thread entries', async () => {
  const calls = []
  const run = async (args) => {
    calls.push(args)
    if (args[0] === 'box') {
      return envelope({ postings: [
        {
          topic_id: 42,
          name: 'Quarterly update',
          summary: '**Revenue** is up.',
          seen: false,
          active_at: '2026-09-17T10:00:00Z',
        },
        { id: 9, kind: 'bundle', name: 'Bundled sender' },
      ], next_page: 'page-2' })
    }
    if (args[0] === 'thread') {
      return envelope([
        {
          id: 100,
          created_at: '2026-09-17T09:00:00Z',
          creator: { id: 7, name: 'Ada', contactable_type: 'Person' },
          body: 'Hello **Emmanuel**',
        },
        {
          id: 101,
          created_at: '2026-09-17T10:00:00Z',
          creator: { id: 8, name: 'Emmanuel', contactable_type: 'User' },
          body: 'Thanks',
        },
      ])
    }
    return envelope({ status: 'sent' })
  }
  const provider = createHeyProvider({ run })

  assert.deepEqual(await provider.recentConversations('starting-page'), {
    items: [{
      id: '42',
      title: '* Quarterly update',
      latestMessage: 'Revenue is up.',
      timestamp: Date.parse('2026-09-17T10:00:00Z'),
      unread: true,
      reactions: [],
    }],
    nextCursor: 'page-2',
    hasMore: true,
  })
  assert.deepEqual(calls[0], ['box', 'view', 'imbox', '--page', 'starting-page', '--json'])
  assert.deepEqual(await provider.recentMessages('42'), {
    items: [{
      id: '100',
      conversationId: '42',
      sender: 'Ada',
      senderId: '7',
      timestamp: Date.parse('2026-09-17T09:00:00Z'),
      body: 'Hello Emmanuel',
      reactions: [],
    }, {
      id: '101',
      conversationId: '42',
      sender: 'You',
      senderId: '8',
      timestamp: Date.parse('2026-09-17T10:00:00Z'),
      body: 'Thanks',
      reactions: [],
    }],
    nextCursor: null,
    hasMore: false,
  })
  const target = await provider.resolveReplyTarget('42')
  assert.deepEqual(target, { type: 'hey', topicId: '42', label: 'Quarterly update' })
  await provider.send(target, 'On it')
  assert.deepEqual(calls.at(-1), ['reply', '42', '-m', 'On it', '--json'])
})

test('HEY provider rejects non-numeric thread IDs', async () => {
  const provider = createHeyProvider({ run: async () => { throw new Error('should not run') } })
  assert.equal(await provider.recentMessages('../credentials'), null)
  assert.equal(await provider.resolveReplyTarget('../credentials'), null)
})
