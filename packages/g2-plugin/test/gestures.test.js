import assert from 'node:assert/strict'
import test from 'node:test'
import { OsEventTypeList } from '@evenrealities/even_hub_sdk'
import { gestureFromEvent } from '../src/gestures.js'

test('gestureFromEvent reads a click from any channel', () => {
  assert.equal(gestureFromEvent({ sysEvent: { eventType: OsEventTypeList.CLICK_EVENT } }), 'click')
  assert.equal(gestureFromEvent({ listEvent: { eventType: OsEventTypeList.CLICK_EVENT } }), 'click')
  assert.equal(gestureFromEvent({ textEvent: { eventType: OsEventTypeList.CLICK_EVENT } }), 'click')
})

test('gestureFromEvent treats a channel with no eventType as a click', () => {
  assert.equal(gestureFromEvent({ sysEvent: {} }), 'click')
})

test('gestureFromEvent recognizes scroll, long-press, and double-click', () => {
  assert.equal(gestureFromEvent({ textEvent: { eventType: OsEventTypeList.SCROLL_TOP_EVENT } }), 'scrollUp')
  assert.equal(gestureFromEvent({ textEvent: { eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT } }), 'scrollDown')
  assert.equal(gestureFromEvent({ sysEvent: { eventType: OsEventTypeList.LONG_PRESS_EVENT } }), 'longPress')
  assert.equal(gestureFromEvent({ textEvent: { eventType: OsEventTypeList.LONG_PRESS_RELEASE_EVENT } }), 'longPressRelease')
  assert.equal(gestureFromEvent({ sysEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } }), 'doubleClick')
})

test('gestureFromEvent prefers the more specific gesture when channels disagree', () => {
  const event = {
    sysEvent: { eventType: OsEventTypeList.CLICK_EVENT },
    textEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT },
  }
  assert.equal(gestureFromEvent(event), 'doubleClick')
})

test('gestureFromEvent returns null when no channel is present', () => {
  assert.equal(gestureFromEvent({}), null)
})

test('gestureFromEvent ignores unrecognized event types', () => {
  assert.equal(gestureFromEvent({ sysEvent: { eventType: OsEventTypeList.SYSTEM_EXIT_EVENT } }), null)
})
