import { startGlintPlugin } from '@glint/g2-plugin'

await startGlintPlugin({
  appId: 'glint-whatsapp',
  appName: 'WhatsApp',
  displayName: 'Glint WhatsApp',
  logSlug: 'glint-whatsapp',
  bridgeUrl: import.meta.env.VITE_BRIDGE_URL,
  bridgeToken: import.meta.env.VITE_BRIDGE_TOKEN,
  devBridgeUrl: import.meta.env.DEV ? 'http://127.0.0.1:8788' : undefined,
  devBridgeToken: import.meta.env.DEV ? 'glint-whatsapp-dev' : undefined,
  emptyStateTitle: 'No conversations',
  emptyStateDetail: 'The bridge returned no WhatsApp conversations.',
  replyFailureDetail: 'The draft expired or WhatsApp was unavailable.',
  allowedHealthProviders: ['whatsapp', 'mock'],
  capabilities: { reactions: true, quotedReplies: true },
})
