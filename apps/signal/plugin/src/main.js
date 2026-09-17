import { startGlintPlugin } from '@glint/g2-plugin'

await startGlintPlugin({
  appId: 'glint-signal',
  appName: 'Signal',
  displayName: 'Glint Signal',
  logSlug: 'glint-signal',
  bridgeUrl: import.meta.env.VITE_BRIDGE_URL,
  bridgeToken: import.meta.env.VITE_BRIDGE_TOKEN,
  devBridgeUrl: import.meta.env.DEV ? 'http://127.0.0.1:8787' : undefined,
  devBridgeToken: import.meta.env.DEV ? 'glint-signal-dev' : undefined,
  emptyStateTitle: 'No conversations',
  emptyStateDetail: 'The bridge returned no Signal conversations.',
  replyFailureDetail: 'The draft expired or Signal was unavailable.',
  capabilities: { reactions: true, quotedReplies: true },
})
