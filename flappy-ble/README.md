# Pip & Bolt — Sky Rescue · Flappy BLE 5.0.0

A child-facing redesign of the three-stage iCreator device-Blockly course, not a separate host or a browser-only hardware simulator.

## The adventure

The UI shows one activity at a time: mission map → short illustrated brief → dedicated Blockly workshop → connect/upload launch screen → full-window flight → reward screen. Code, raw device data, readback and resource diagnostics live in the Grown-up tools drawer, not on the child's welcome page. Narrow screens switch between Example and Your blocks tabs rather than squeezing two workspaces side by side.

Pip is the flying bird. Bolt is the physical Crowbot. Character artwork/brief animations are illustrations, not live device telemetry.

1. **Wake the forest:** 3 gates. Teach `start → light on`, `stop → light off`. This lesson contains **no motor-start or motor-stop calls**.
2. **Send a sparkle:** 5 gates. Clearing a gate sends `pipe`; the uploaded callback repeats a short off/on light pattern twice. Still **no motor calls**.
3. **Rescue the stars:** 7 gates. Gates 3 and 6 send `milestone`, requesting two short rescue rolls. The new roll block starts both wheels, waits 120 ms, and stops both in a device-side `finally` block. Only this motor-using lesson includes final wheel parking. An adult-supervision/clear-floor checkbox is required before playing or testing motion.

The worlds have distinct palettes/scenery. Flights give three hearts, brief collision recovery, collectible stars, streak feedback, and earned mission stars/badges. Controls are tap/click, Space, or Up; Down remains a keyboard convenience, not an extra primary button. No button-press BLE stream is generated.

## Build, send, then fly

A new mission starts with one empty device-program root. The real Blockly example is read-only. The checker ignores position/IDs and compares the lesson's message handlers, actions, values and nesting. It gives one actionable mismatch at a time. Hint → Still stuck → Use finished example is a deliberate rescue path, with an in-page confirmation and backup, not a pre-filled answer.

The upload gate remains real: the current program must match, and the exact frozen Blockly JSON plus Python must receive a `device-confirmed` result through `sdk.device.upload`. Editing semantic blocks, reconnecting, reopening or observing another client's upload invalidates the receipt. No hardware action happens by dragging blocks or opening a preview. An optional **Try Bolt's trick** explicitly sends the lesson messages, then STOP; the user observes actual behavior. The UI does not claim to sense it.

## Full-window gameplay, not a tiny preview

Starting automatically replaces all editing panels with a fixed, viewport-filling game surface and a 3–2–1 countdown. The Canvas camera follows the viewport aspect ratio. HUD controls include pause, exit and optional browser fullscreen. Browser fullscreen is requested only from its button; denial falls back to the already full-window game. Leaving the game exits module-owned fullscreen. No windows, iframes, parent access or host navigation APIs are created.

Pause freezes physics and attempts priority STOP. Resume sends start before continuing. Hidden/disposed modules never initiate hardware sends. Hiding cancels an active round, invalidates its receipt and requires attention on return. Closing never disconnects the shared device.

## Device transport and safety limits

Only the supplied Crowbot ESP32 compatibility contract is targeted: `integem-crowbot-mqtt-v1`, entry `def MQTT(mqtt_msg, voltage):`, two-space body indentation. The host owns BLE, b/m framing, Unicode chunking, pacing and ACK interpretation. Teaching function names remain replaceable in the module generator, not a host whitelist. The generator submits final Python and the same workspace with `workspacePolicy: replace`.

Ordinary feedback has a one-slot coalescing queue. STOP invalidates pending ordinary events, including one waiting for the rate limit; an already accepted write cannot be preempted. Failed commands are not automatically retried. The grown-up Send STOP action provides an explicit retry; a failed stop blocks another round.

A write/ACK is not proof of physical execution. The browser cannot interrupt device-side `sleep_ms`, guarantee a motor stops after a power/library fault, or observe actual displacement. The roll's `finally` is a best-effort program cleanup, not a certified safety mechanism. Supervise the robot on a clear floor, away from edges. Do not put it on a desk simply because a command is brief.

## Readback, recovery and persistence

Grown-up tools retains the real `get_device_block_xml` notification-based workspace readback: bounded streaming UTF-8, connection/project/sequence filtering, first-byte/idle/total timeouts, raw-data preservation and temporary-Blockly validation. An explicit in-page replacement backs up edits. The preview says Generated from recovered blocks, never Device source. Multi-client readback is not exclusive and conflicting activity aborts it.

The module ID stays `flappy-ble`. v5 uses `course.v5.progress`, `course.v5.stage.1/2/3`, `course.v5.backup`, `course.v5.upload.1/2/3`, `course.v5.medals` and `course.v5.readback.raw`. Existing v4 unlocked/completed progress migrates non-destructively into v5. Old v4 and v3 draft keys are kept, not deleted or silently treated as new light-only solutions. The redesigned lessons have separate new workspaces. Upload receipts are never restored as live device authorization.

## Build and verification

Complete editable TypeScript is in `source/flappy-ble/src`. Development uses Node 22, pinned TypeScript 5.8.3, Blockly 8.0.0 and Playwright 1.55.1. `npm ci`, `npm run build`, `npm test`, `npx playwright install chromium`, `npm run test:browser`, `npm run test:media`. Installed releases need no npm, server or internet.

All upstream Blockly media, including .cur/GIF/audio, remain local. Audio playback is off. The host must implement the supplied 2026-09-22 resource update. Static CSS URLs are CSS-relative; dynamic Blockly styles use the module-root media path. Packaging still rejects unsafe paths, duplicates, symlinks, secrets/build folders and oversize resources. No font files have been added.

See VERIFICATION.md and CI evidence for actual results. Browser/protocol mocks are explicitly distinct from physical Crowbot, actual iCreator App/Web containers, the official host validator, and host Blob URL mapping. No real-device certification is claimed.
