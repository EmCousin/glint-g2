import { startGlintPlugin } from '@glint/g2-plugin'

await startGlintPlugin({
  appId: 'glint-hey',
  appName: 'HEY',
  displayName: 'Glint HEY',
  logSlug: 'glint-hey',
  bridgeUrl: import.meta.env.VITE_BRIDGE_URL,
  bridgeToken: import.meta.env.VITE_BRIDGE_TOKEN,
  devBridgeUrl: import.meta.env.DEV ? 'http://127.0.0.1:8789' : undefined,
  devBridgeToken: import.meta.env.DEV ? 'glint-hey-dev' : undefined,
  emptyStateTitle: 'No email',
  emptyStateDetail: 'The bridge returned no replyable Imbox threads.',
  replyFailureDetail: 'The draft expired or HEY was unavailable.',
  capabilities: { reactions: false, quotedReplies: false },
})
