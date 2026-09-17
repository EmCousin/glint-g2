import { createBridgeApp } from '@glint/bridge'

export function createApp(options) {
  return createBridgeApp({
    ...options,
    capabilities: {
      quotedReplies: true,
      reactions: true,
      sentMessageIds: false,
    },
  })
}
