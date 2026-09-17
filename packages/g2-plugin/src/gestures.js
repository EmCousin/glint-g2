import { OsEventTypeList } from '@evenrealities/even_hub_sdk'

// Checked in this order because a native event can only ever report one
// underlying OS event type, and double-click/long-press are more specific
// than a plain click - if any channel reports one of these, it wins.
const GESTURES_BY_PRIORITY = [
  [OsEventTypeList.DOUBLE_CLICK_EVENT, 'doubleClick'],
  [OsEventTypeList.LONG_PRESS_EVENT, 'longPress'],
  [OsEventTypeList.LONG_PRESS_RELEASE_EVENT, 'longPressRelease'],
  [OsEventTypeList.SCROLL_TOP_EVENT, 'scrollUp'],
  [OsEventTypeList.SCROLL_BOTTOM_EVENT, 'scrollDown'],
  [OsEventTypeList.CLICK_EVENT, 'click'],
]

function channelEventType(envelope) {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

// The bridge reports the same physical gesture on whichever of sysEvent,
// listEvent, or textEvent happens to be active for the current view, so a
// single normalized gesture replaces checking each channel everywhere.
export function gestureFromEvent(event) {
  const channels = [
    channelEventType(event.sysEvent),
    channelEventType(event.listEvent),
    channelEventType(event.textEvent),
  ]
  const match = GESTURES_BY_PRIORITY.find(([osEventType]) => channels.includes(osEventType))
  return match?.[1] ?? null
}
