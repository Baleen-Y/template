# Crowbot Parcel Pals 1.2.0 — Guided first, cruise next

Independent iCreator module `crowbot-parcel-pals`. Flappy BLE is unchanged.

## What changes for a child

Mission 1 keeps the tutorial: choose the highlighted arrow (or Space), watch the
short real robot action, then click what you observed. New players still learn
what a route block, turn and observation mean.

Missions 2 and 3 default to **Route Cruise**. After the existing connect/upload/
light check and supervised-floor preparation, **Start route cruise** starts the
entire uploaded finite route. There is no per-step Drive button or Yes dialog.
The map fills the play view; only Pause and STOP ROBOT remain in its header.
At the end, one **Yes — we delivered!** observation awards the mission, or
**Not quite — let's fix it** returns to setup without awarding completion.

The collapsed **Need the step-by-step helper?** option can restore guided play
on later missions. Choosing it does not change the Blockly solution. Reopening
or selecting a new mission uses its age-appropriate default again.

## Program, upload, then play

Mission map → mission → Blockly workshop → connect/upload/check/setup → delivery → stamps.

1. Maple: go forward twice, deliver, park. Learn sequencing.
2. Finn: turn around the pond, deliver, park. Learn headings.
3. Milo and Olive: deliver to two friends with a repeating pattern. Learn loops.

All new drafts start with one empty route root. A real, read-only Blockly example
is available. Alternative valid routes are accepted; map bounds, pond avoidance,
delivery order, final parking and mission 3's repeat requirement are checked.
Hints, backed-up example copy, reset, readback and local recovery are retained.

Upload freezes actual Blockly JSON and generates Python from the same snapshot.
The real `sdk.device.upload` uses `kind: micropython`, `workspacePolicy: replace`,
source and workspace. `watchUpload` / `waitForUpload` supply real host job state.
A matching `device-confirmed` receipt is required, not a fake success timer.
A visible light-only check still asks the person to observe two real blinks.
No motor starts merely from connecting, uploading, opening an editor or a preview.

**After updating to 1.2.0, upload again.** Resume support changes the generated
callback. The normal 19-byte `p2` packets, legacy `stop`, host b/m upload framing,
and `get_device_block_xml` readback remain. Runtime identity is revised so a
stale callback cannot accidentally qualify as this version's uploaded program.

## Cruise is a paced program, not autonomous navigation

The browser sends one finite route step at a time, after the previous write
returns and a conservative estimated action interval elapses (configured
movement time plus 500 ms; delivery signals have their own bounded delay).
There is no unbounded command queue, repeated-key motor stream or automatic
retry. A BUSY, stale connection, disconnect or failed write aborts the route.
It is NOT an exclusive multi-client transaction: foreign host activity cancels
this module's run; the host's operation lock remains authoritative.

The dashed cursor and route progress are **program previews on estimated timing**,
not live GPS, sensed arrival or execution acknowledgements. The last confirmed
position remains the user's START observation until the final observation.
No intermediate delivery tick, stored completion or medal is produced by a
write, countdown or animation. Only the final explicit on-screen observation
can award completion. Space and Enter cannot answer it automatically.

Do not reach toward the wheels to place paper parcels while cruise is moving.
Place them only after pausing or after the final stop, with adult assistance.
No gripper, obstacle detection, position feedback or new firmware sensor is assumed.

## Pause, resume and STOP

Space or P toggles Pause/Resume. Esc or Down requests STOP and ends the run.
Direction keys cannot add motion during cruise; the uploaded blocks choose it.
In the guided and optional Practice contexts, existing arrow meanings remain.

Pause cancels a command still waiting for its rate slot. If a write has already
been accepted, its short self-stopping action and estimated cooldown may finish
first. Then STOP is written and the UI becomes Paused. Resume is a new explicit
user action, using a fresh run nonce and the next UNSENT step index. It never
replays an already accepted step. Resume only when Bolt is still at the expected
place and heading; if it drifted, end the run and reset instead.

STOP ROBOT is the immediate stop request. It invalidates future ordinary commands,
including a selected rate-waiting step. Already accepted GATT cannot be preempted.
A failed STOP is not retried automatically and does not qualify for completion.
After all route writes, final STOP precedes the end observation. The observation
itself does not send a second, redundant STOP.

Hiding/disposal cancels pending timers and play authorization. Hidden modules
never initiate hardware operations, and reopening never auto-resumes. Changing
device/program/session or another client's use of shared hardware cancels play.
No module closes another client's connection just because it is hidden/closed.

## Physical floor, calibration and limits

Use low-tack tape/paper labels on a clear, supervised FLOOR, away from edges,
people, pets and stairs. Use the adult settings and explicit short Practice tests
to calibrate forward/left/right times (80–1000 ms) and speed (15–45).
Default timings 350/280/280 ms and speed 30 are NOT calibrated distances/angles.
Surface, battery and wheel variation can cause drift. Recheck real movements.
Each run requires supervision and START-position confirmation. Cruise requires
continued observation and readiness to STOP, not unsupervised robot operation.

Each device action uses paired motor stops with nested `finally` cleanup.
This is best-effort program cleanup, not certified hardware safety. Blocking
`sleep_ms`, firmware/library errors, power faults and lost BLE can delay or
prevent stopping. Attend to the robot and use its physical power switch as needed.
An upload ACK or returned write does not prove actual movement or physical stopping.

## Device, readback and persistence

Only the supplied Crowbot ESP32 compatibility profile is targeted:
`integem-crowbot-mqtt-v1`, final `def MQTT(mqtt_msg, voltage):`, two-space indentation.
The host supplies wrapper, b/m framing, transfer pacing and ACK handling.
Command-library example names remain replaceable in `src/model.ts`; they are
not host SDK methods. The step table is chosen by the uploaded callback, not
by a browser-only Blockly hardware simulator.

Real notification readback is retained behind Grown-up tools. Subscribe before
`get_device_block_xml`; use streamed UTF-8/JSON, target/session/sequence filtering,
256 KiB cap and 5 s first-byte / 5 s idle / 60 s total timeouts. Conflicting
activity cancels it. Preserve raw incompatible data; validate in temporary
Blockly; confirm replacement and back up current work. Regenerated source is
labeled generated from recovered blocks, never actual downloaded device source.

Same module ID and all `parcel.v1.*` draft, timing, progress and backup keys.
The update does not reset solved missions, replace custom blocks with examples,
or reuse an old upload receipt. Final observation metadata distinguishes
`whole-route` cruise observations from `per-step` guided observations.
Switching from Flappy to this game requires uploading this game's callback again.

## Build and evidence

Complete editable TypeScript is in `source/crowbot-parcel-pals`. Node 22, pinned
TypeScript 5.8.3, Blockly 8.0.0 and Playwright 1.55.1. Development:
`npm ci`, `npm run build`, `npm test`, `npx playwright install chromium`,
`npm run test:browser`, then `node --experimental-strip-types package-release.ts`.
The release needs no npm, development server or external network.

Upstream .cur/GIF/audio assets remain locally bundled. Audio playback is off;
the installed iCreator host must include the supplied resource-import update.
Packaging still enforces root, duplicate/path, secret, symlink and size rules.
No environment font files, node_modules or test assets are in the release.

See VERIFICATION.md for actual tests. Unit/protocol tests and real-Blockly
headless browser tests use an explicitly mocked iCreator SDK. Actual iCreator
App/Web import, host Blob mapping, official module-kit and physical Crowbot are
separate and remain untested where unavailable. No sensor/physical certification
is inferred from simulated success.
