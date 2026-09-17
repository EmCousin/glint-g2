import { createBridgeApp } from '@glint/bridge'

export function createApp(options) {
  return createBridgeApp({
    ...options,
    capabilities: {
      quotedReplies: false,
      reactions: false,
      sentMessageIds: false,
    },
  })
}
