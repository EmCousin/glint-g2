# Changelog

All notable changes to the Glint Signal plugin, by `app.json` version. Even Hub
appears to no-op a re-upload at an unchanged version number, so every real
hardware test needs a bump even without a code change.

## 0.1.31 (shared monorepo runtime)

- Use the shared Glint G2 plugin runtime without changing Signal capabilities.

## 0.1.30 (automatic history pagination)

- Load older conversations and messages automatically at list boundaries.
- Preserve complete Signal message bodies instead of truncating them at 2,000 characters.

## 0.1.29 (full message reader)

- Added a full-screen message reader with swipe paging for long message bodies.

## 0.1.28 (mobile companion and runtime bridge settings)

- Added a live mobile preview built from the same layout descriptors sent to
  the glasses, including the current selection and reactions menu.
- Added endpoint and token configuration in the Even mobile app, persisted
  through Even Hub local storage and applied without rebuilding the plugin.
- Added mobile connection status, responsive styling, and clearer setup
  guidance when the bridge is unavailable.

## 0.1.27 (restore the original 3/4-container-per-card design)

0.1.26 confirmed working across all three screens. Looking back at the
commit that first collapsed every card down to a single container ("Real
G2 hardware rejected a 7-text-container page outright"), its container
names included things like `conversation-0-metadata` (23 chars) and
`conversation-0-body` (19 chars) - both well over the containerName length
limit just discovered. That "7 containers rejected" conclusion was almost
certainly the same containerName-length bug, misdiagnosed as a hard count
limit, since the count and the name length both changed at once in that
one test.

- Restored the original per-card layout: a title container, a real
  right-aligned metadata column (time + reactions), a body container, and
  (for replies) a dimmed quote block - instead of one container with
  everything jammed into a single text blob.
- Every name shortened to fit under 15 chars: `conversation-N` ->
  `conv-N`, with `-b`/`-md`/`-q` suffixes for body/metadata/quote
  (`conv-0-b`, `msg-0-md`, etc.) instead of the original `-body`/
  `-metadata`/`-quote`.
- `MAX_TEXT_CONTAINERS` restored to 8 (the documented SDK per-page limit)
  instead of the conservative 6 chosen while the real bug was still
  unknown. The container-budget fallback logic (drop to one visible
  message if two replies would exceed the budget) is back too.
- **Confirmed working on real hardware** - the richer, multi-container
  design renders correctly across the conversation list, message list, and
  reactions menu. This settles it: the original "7 containers rejected"
  finding was the containerName-length bug the whole time, not a real
  count limit. `MAX_TEXT_CONTAINERS = 8` (the documented SDK cap) is a real
  ceiling now, not a guess.

## 0.1.26 (real fix - shorten every containerName, wire real function back in)

0.1.25 **failed** - confirmed the 22-char `conversation-scrollbar` name
alone (with everything else known-safe) is enough to reject the page.
Root cause found after 15 versions of bisection: real G2 hardware silently
rejects an entire `rebuildPageContainer` call if any single container's
`containerName` is too long. The exact cutoff is unconfirmed (bracketed
between 15, confirmed safe, and 22, confirmed unsafe), so every name in the
codebase is now kept at or under a conservative 15-char limit
(`MAX_CONTAINER_NAME_LENGTH` in `layout.js`).

- Renamed `conversation-scrollbar` (22) -> `conv-scrollbar` (14).
- Renamed `message-scrollbar` (17, untested but in the same risk range) ->
  `msg-scrollbar` (13).
- Renamed `message-actions-title` (22) -> `actions-title` (13).
- `renderConversationCards()` in `main.js` now calls the real
  `conversationCardContainers()` with live `state.conversations` /
  `state.selectedConversationIndex` again - the diagnostic
  `debugMinimalContainers()`/`DEBUG_CONVERSATIONS` scaffolding is retired
  from the render path (the functions/dumps themselves are left in place as
  a safety net, not deleted).
- This is the first version since 0.1.2 that renders the real, live
  conversation list rather than a hand-built diagnostic page. If this
  works, the whole "Display error" saga was this one naming convention.

## 0.1.25 (diagnostic - isolate scrollbar name alone)

0.1.24 **succeeded** - real 14-char card names (`conversation-0`/
`conversation-1`) are fine. Card names ruled out.

- Reverted cards to the known-working `debug-a`/`debug-b`. Changed only the
  scrollbar's containerName to the real 22-char `conversation-scrollbar`.
- If this fails (expected), it confirms containerName length (or this
  specific string) as the real root cause - and the real, shipping
  `conversationCardContainers`/`messageCardContainers`/
  `reactionsMenuContainers` all use names in this same range
  (`conversation-scrollbar` 22, `message-actions-title` 22,
  `message-scrollbar` 17), so this would explain the entire "Display error"
  bug from day one, not just a diagnostic artifact.

## 0.1.24 (diagnostic - bisect which containerName)

0.1.23 **failed** - confirmed via the bridge log (exact 0.1.23 payload
logged as rejected). containerName is the trigger, the first genuinely new
lead in a long time - and these are the real, shipping names, so this may
be the actual root cause of the real feature, not just a diagnostic
artifact. The new names are also notably longer than what's worked so far:
`conversation-scrollbar` is 22 chars vs `debug-scrollbar`'s 15;
`conversation-0`/`conversation-1` are 14 vs `debug-a`/`debug-b`'s 7 -
possibly a containerName length limit.

- Renamed only the two cards to the real `conversation-0`/`conversation-1`
  (14 chars). Left the scrollbar at the known-working `debug-scrollbar`
  (15 chars) instead of the real `conversation-scrollbar` (22 chars).
- If this fails, the 14-char card names alone are enough to trigger it
  (points at something in the string itself, not just length). If it
  succeeds, the 22-char scrollbar name is specifically implicated, and
  containerName length is a strong lead.

## 0.1.23 (diagnostic - isolate containerName alone)

0.1.22 **succeeded** - real containerIDs (200/201/206) with `debug-*` names
and the long wrapped body still work. containerID value is ruled out.

- Changed only `containerName` from `debug-a`/`debug-b`/`debug-scrollbar` to
  the real `conversation-0`/`conversation-1`/`conversation-scrollbar`.
  containerID, content, and every other field stay exactly as in the
  succeeding 0.1.22 build.
- If this now fails, containerName is the trigger. If it still succeeds,
  the only remaining difference against the real, failing
  `conversationCardContainers()` payload is content text - next step would
  swap in the real short bodies ("No"/"Ok") verbatim.

## 0.1.22 (diagnostic - isolate containerID alone)

0.1.21's regression check **succeeded** - `debugMinimalContainers()`
unchanged (IDs 80/81/82, `debug-*` names, long wrapped body) still works,
ruling out device/firmware degradation as the explanation. That also
exposed a gap in the earlier "byte-for-byte identical" proof: it only
verified the constructor produces identical descriptors for matching
inputs, never actually diffed `debugMinimalContainers()`'s own values
against `conversationCardContainers()`'s own values. Three things differ
between this success and the last failure: containerID, containerName, and
content. Testing containerID alone first since it's never been isolated on
its own.

- Changed only `containerID` in `debugMinimalContainers()` from 80/81/82 to
  the real values 200/201/206. Names, content, and every other field stay
  exactly as they were in the succeeding 0.1.21 build.
- If this now fails, containerID value (not reuse, which was already ruled
  out - see 0.1.18) is the trigger, maybe a slot-index constraint tied to
  `containerTotalNum`'s 1-12 range. If it still succeeds, containerName or
  content is next.

## 0.1.21 (diagnostic - regression sanity check)

0.1.20 (real `conversationCardContainers()` output, byte-for-byte identical
to a previously-succeeding hand-built payload down to `Object.keys()`,
prototype, `instanceof`, and full property descriptors) **still failed**,
and a full power-cycle of the glasses afterward didn't change that either.
At this point every field-level and device-state hypothesis is exhausted, so
before looking further, confirm the ground truth hasn't shifted underneath
us.

- Swapped `renderConversationCards()` back to call `debugMinimalContainers()`
  unchanged - the exact function that succeeded on real hardware in 0.1.10.
- If this still succeeds, the difference really is something in
  `conversationCardContainers()` not yet found, despite the identical-payload
  proof. If it now fails too, something changed independent of our code
  (device/firmware state continuing to degrade, or an environment change),
  and no further field-diffing in our code will fix it - next step would be
  escalating to Even Realities with the full repro.

## 0.1.20 (diagnostic - test without wrapped text)

0.1.19's dump revealed the first real, confirmed content difference: the
device's real canvas-measured wrap for "Daniele Angeli"'s body was
`"...qu'on peut\ndemander..."`, while my earlier hand-copy (generated with a
rough character-count approximation, not the real canvas metrics) had wrapped
it as `"...qu'on\npeut demander..."`. Every "working" test before 0.1.11 used
hand-typed content, so this is the first time text wrapped by the real
device's own font metrics was actually exercised. If the webview's canvas
font doesn't perfectly match the real firmware's text renderer, a line we
measure as fitting could still overflow on the real display and get
rejected outright rather than just clipped.

- Testing directly: both fake conversations now have short bodies ("No",
  "Ok") that never need wrapping, isolating whether wrapped multi-line text
  is the trigger.

## 0.1.19 (diagnostic - dump content and containerName too)

0.1.18 (fresh, never-before-used containerIDs) **failed identically** per the
bridge log - ruling out container identity too. Every structural field has
now been individually verified via the device's own logged data. The one
thing never actually dumped and cross-checked was the `content` string
itself and `containerName`.

- `describeContainer` now includes `containerName` and the full
  JSON-stringified `content` (so hidden characters, encoding issues, or
  unexpected whitespace would be visible), plus its length.

## 0.1.18 (real fix attempt - found via the bridge log)

0.1.17's bridge log showed the exact rejected payload on every 5-second
refresh: `10:8,8,552,134 bw0 bc- pd8 cap0 z0` /
`11:8,150,552,134 bw3 bc5 pd8 cap1 z1` / `16:560,8,4,176 ...` - byte-for-byte
identical to the confirmed-working 0.1.10 diagnostic in every field except
`containerID`/`containerName` (10/11/16 + `conversation-*` here vs 80/81/82
+ `debug-*` there). Every other field had already been individually ruled
out through on-device testing, which leaves container identity as the one
remaining variable.

containerID 10/11/16 have been reused across dozens of different layouts
throughout this entire debugging session (all the way back to the very
first hardware test); 80-82 had never been used for anything before the
diagnostic that worked.

- Conversation cards now use containerID 200/201, scrollbar 206 - numbers
  never used anywhere in this app before.

## 0.1.17 (same diagnostic, now logged to the bridge instead of on-screen only)

Copying multi-line text off the glasses' tiny screen isn't practical. Added
`POST /api/debug-log` to the bridge (logs whatever text it's given, behind
the same bearer token) and a matching `client.debugLog()` on the plugin
side. The rejected-container dump from 0.1.16 is unchanged, but now also
gets posted there, landing directly in the bridge's own log output instead
of needing to be read and retyped from the device.

## 0.1.16 (change of approach - show the device's own data, stop guessing)

0.1.15 (fields byte-for-byte identical to the confirmed-working diagnostic)
**still failed identically**. That result means either there's still a
difference I haven't found, or something other than container field values
is involved (timing, call sequence, device state). Continuing to
hand-reconstruct "what should be identical" off-device isn't reliable enough
to keep trusting - two earlier rounds already had unnoticed drift.

Changed approach: the error screen itself now dumps the structural fields
(id, x, y, width, height, borderWidth, borderColor, paddingLength,
isEventCapture, zOrderIndex) of every container in the rejected call,
directly on the glasses. This makes the device the source of truth for what
was actually sent, instead of my reconstruction of it.

## 0.1.15 (diagnostic - true apples-to-apples comparison)

0.1.14 (`selectedIndex: 1`) **failed identically**. Diffing its exact output
against the working 0.1.10 diagnostic found one more uncontrolled variable:
the scrollbar's `yPosition` also depends on `selectedIndex` (it reflects
true scroll position - correct behavior, but it moved from `8` to `52`
between the two tests). With that, the two card containers were finally
byte-for-byte identical, but the scrollbar wasn't.

- This version forces the scrollbar's `yPosition` back to `8` after building
  the real cards, so every single field across all 3 containers now matches
  the confirmed-working 0.1.10 diagnostic exactly (only `containerID`/
  `containerName` strings differ). If this still fails, the cause is
  something other than container field values entirely.

## 0.1.14 (diagnostic - found the real variable)

0.1.13 (`yPosition` matched to the working diagnostic) **failed identically**.
Directly diffing the exact JSON of the working 0.1.10 diagnostic against the
real function's current output revealed the actual mistake in this whole
comparison: they weren't apples-to-apples. Every diagnostic build had put the
bordered/interactive (`isEventCapture: 1`) styling on the *second* box; the
real function always puts it on the *first* card, because `selectedIndex: 0`
always selects the first conversation. All the "matching" fields were red
herrings - the position of the interactive container was the one variable
that was never actually controlled for.

- Testing directly: same real function, same fake data, `selectedIndex: 1`
  instead of `0`, so the second card is the interactive one instead of the
  first - exactly matching every prior successful diagnostic's shape.

## 0.1.13 (real fix attempt, using the confirmed-broken repro)

0.1.12 (conditional `borderColor`) **failed identically**. That was the last
field-level difference I'd found - which leaves exactly one remaining
variable between the working 0.1.10 diagnostic and the failing real
function: `yPosition`. The real formula is `4 + slot * 142` (4, 146); the
diagnostic that worked used `8`/`150`.

- Card `yPosition` changed from `4 + slot * 142` to `8 + slot * 142`.
  Still using the same fake `DEBUG_CONVERSATIONS` for a clean comparison.

## 0.1.12 (real fix attempt, using the confirmed-broken repro)

0.1.11 - the real `conversationCardContainers()` fed hardcoded fake
data - **failed identically** (`rejected (3 containers)`), proving the bug is
genuinely in that function, not the live fetched data. Comparing against the
0.1.10 diagnostic (which had drifted slightly but worked), the one remaining
difference was `borderColor: 5` being set unconditionally, even on
unselected cards with `borderWidth: 0`. The working diagnostic never set
`borderColor` at all on its zero-border box.

`statusContainer` also pairs `borderWidth: 0` with `borderColor: 5` and has
always worked - but it's always the sole container on its page. Every
successful multi-container diagnostic happened to never combine
`borderWidth: 0` with a set `borderColor` alongside other containers; the
real function always did. This is the one remaining variable.

- `cardContainer` now only sets `borderColor` when the card is selected
  (has an actual border to color). Kept the same fake `DEBUG_CONVERSATIONS`
  from 0.1.11 for a clean before/after comparison - reverting to live
  `state.conversations` once this is confirmed.

## 0.1.11 (diagnostic - not a fix attempt)

0.1.10 also **succeeded** with real content copied verbatim. But re-checking
that copy against the actual `cardContainer` function turned up two small
drifts introduced along the way: the hand-copied box A was missing
`borderColor: 5` (the real function sets it unconditionally, not just on
selected cards), and the boxes used `yPosition: 8`/`150` instead of the real
`4`/`146`. Hand-copying fields into a separate diagnostic function turned out
to be an unreliable way to guarantee parity with the real code.

This version removes that risk entirely: `renderConversationCards` now calls
the actual `conversationCardContainers()` used in production, just with a
hardcoded fake conversations array (`DEBUG_CONVERSATIONS` in `main.js`)
instead of live `state.conversations`. If this fails, the bug is genuinely in
that function. If it succeeds, the bug is something about the real fetched
data specifically, not the rendering code.

## 0.1.10 (diagnostic - not a fix attempt)

0.1.9 also **succeeded** (the missing visible inset for `paddingLength` is a
separate cosmetic question, not a rejection). Every structural field of a
real card - position, size, border, `isEventCapture`, `zOrderIndex`,
`paddingLength` - is now individually confirmed safe in isolation.

The only thing left untested is the dynamic content itself. This version
keeps every field identical to the confirmed-safe 0.1.9 boxes, but replaces
the static "Test A"/"Test B" strings with real content copied verbatim from
`conversationCardContainers()`'s actual output for the two real conversations
("Emmanuel Cousin" with a 👍 reaction, "Daniele Angeli" with a longer
wrapped body) - multi-line, with the blank-line separator and emoji intact.

## 0.1.9 (diagnostic - not a fix attempt)

0.1.8 also **succeeded** - all three containers rendered (both boxes, border
on B, scrollbar on the right). The scrollbar is ruled out too. (Navigation
between the boxes doesn't work in this diagnostic, as expected - it's static
test data with no real selection wiring.)

Field-by-field, there is now exactly one difference left between our test
box B and a real selected card: `paddingLength: 8`. This version adds it to
both boxes. If this also succeeds, the only remaining difference from a real
card is the dynamic multi-line content itself (title + metadata + body +
emoji) - which becomes the next thing to isolate.

## 0.1.8 (diagnostic - not a fix attempt)

0.1.7 also **succeeded** at full real-card size (552x134) - size/area is
ruled out too. Noticed a pattern in hindsight: every failure so far has had
a scrollbar container present (7 = old 3-per-card design + scrollbar; 3 = new
1-per-card design + scrollbar); every successful diagnostic has had none.
This version adds a third container shaped exactly like the real scrollbar
(4px wide, near the right edge, empty content) to the two working boxes, to
test that directly.

## 0.1.7 (diagnostic - not a fix attempt)

0.1.6 also **succeeded** - both boxes rendered, with the selection border
showing on the second. `isEventCapture`, `borderWidth`, and `borderColor` are
now ruled out entirely.

Remaining differences from a real card: much larger size (552x134 vs
200x60), `paddingLength: 8`, dynamic multi-line content with emoji, and the
scrollbar (a 3rd container never tested in isolation). This version bumps
both boxes to full real-card size (552x134), keeping everything else from
0.1.6 identical, to isolate size/area specifically.

## 0.1.6 (diagnostic - not a fix attempt)

0.1.5's minimal 2-box test **succeeded** ("Test A" / "Test B" both rendered) -
multi-container `rebuildPageContainer` works fine on this hardware in
general. Something specific to our real cards triggers the rejection, not
the mechanism itself.

Every failing attempt so far has had its first (selected) conversation card
marked `isEventCapture: 1` with a `borderWidth: 3` selection border; the
working 0.1.5 test used `isEventCapture: 0` with no border on both boxes.
This version changes exactly one of the two working boxes to match a real
selected card's `isEventCapture`/`borderWidth`/`borderColor`, isolating
whether that specific combination is the trigger.

## 0.1.5 (diagnostic - not a fix attempt)

0.1.4 failed identically, which disproves the "monotonic growth past the
startup declaration" theory too: it reserved 6 containers up front and still
failed going *down* to 3. Every plausible structural hypothesis (count,
z-order, border radius, scrollbar position, growth past declaration) is now
ruled out.

Rather than guess again, this swaps the conversation list for
`debugMinimalContainers()` - two hardcoded, static text boxes, no dynamic
content, no scrollbar - to answer one question: does *any* multi-container
`rebuildPageContainer` call succeed on this hardware, independent of our
actual content? `conversationCardContainers` is untouched and stays covered
by tests; only the call site in `renderConversationCards` is swapped, clearly
marked for revert.

## 0.1.4 (failed - disproved the "monotonic growth" theory)

0.1.3 failed identically (`Conversation list rejected (3 containers)`), which
ruled out `zOrderIndex`, `borderRadius`, and the scrollbar's position as
factors. New theory: the glasses reject any `rebuildPageContainer` call whose
`containerTotalNum` exceeds what `createStartUpPageContainer` originally
declared - every screen that has ever rendered successfully used exactly the
1 container declared at startup; every screen that increased the count past
that has failed, regardless of the actual number.

- `createStartUpPageContainer` now declares `MAX_TEXT_CONTAINERS` (6) up
  front - 1 real status container plus 5 invisible 1x1 placeholders - so
  later screens can use up to 6 without exceeding the initial declaration.
  Later screens are unchanged otherwise.

## 0.1.3 (failed - exact same rejection as 0.1.2)

Real hardware still rejected the single-container layout from 0.1.2
(`Conversation list rejected (3 containers)`), which disproved the theory that
this was purely about container count. Bundled three low-risk, no-visual-impact
changes to test at once:

- Added an explicit `zOrderIndex` to every text/list container. The SDK docs
  note that omitting it "remains valid for older SDK/app pages," implying it
  may not be for newer ones.
- Removed `borderRadius` from cards and the composer - the one field present
  on our failing containers that the (working) status screen never had.
- Moved the scrollbar from `xPosition: 572` to `560`, off the exact edge of
  the 576-wide canvas.

The SDK's own `validateEvenHubPageContainer` still reports this payload as
valid, confirming it doesn't model whatever real firmware is actually
enforcing.

## 0.1.2 (partial - made the rejection visible, didn't fix it)

Real hardware rejected the conversation list outright
(`Conversation list rejected (7 containers)`), even though the simulator only
ever warned above 8 containers - the simulator was quietly misleading us about
the true budget. This version's fixes reduced the count from 7 to 3 but the
list still didn't render (see 0.1.3) - its main value was turning a silent
freeze into a visible, actionable error message.

- Collapsed every conversation/message card from 3 containers
  (title/body/metadata) or 4 (+ dimmed quote) down to a single container with
  the same content combined. Traded the separate metadata column and dimmed
  quote styling for actually rendering.
- Surfaced `rebuildPageContainer`'s success/failure instead of swallowing it -
  the boolean going unchecked is exactly why the rejection was silent instead
  of visible on the glasses' own screen.
- Added request logging to the bridge so its behavior is observable without
  simulator-side output.

## 0.1.1

No functional change. Re-packaged at a new version number after discovering
Even Hub silently keeps serving the previously-installed build when you
re-upload at the same version.

## 0.1.0

Baseline build carried into the first real-hardware test: gesture rework
(click to expand/select, hold to reply or react depending on selection,
scroll-past-end to compose), quoted-reply indicators, and the `gestures.js` /
`layout.js` / grouped-`state` refactor. Never previously tested outside the
simulator.
