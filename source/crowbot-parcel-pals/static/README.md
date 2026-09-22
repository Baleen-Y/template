# Crowbot Parcel Pals 1.1.0

New independent iCreator module `crowbot-parcel-pals`. Flappy BLE is not modified.

The physical Crowbot is the courier. Children assemble a route in real Blockly, upload that route AND matching workspace, and carry out the delivery on a marked floor. The browser shows the intended route and the last position the child confirmed, not sensor telemetry. A paper parcel is placed by the child/adult; no gripper is assumed.

## Child workflow
Mission map → short mission → dedicated Blockly workshop → floor setup/connect/upload → full-window step-by-step delivery → friend stamps.

1. Maple: go forward twice, deliver, park. Learn sequencing.
2. Finn: go along the path, turn right, avoid the pond, deliver, park. Learn headings.
3. Milo and Olive: use a repeating route pattern to visit both friends. Learn loops.

Each student draft starts with one empty route root. A read-only Blockly example is available. Valid alternative routes are allowed; the checker evaluates map bounds, ponds, delivery order, final parking, and the third mission's repeat requirement. Hints and finished-example rescue are separate. Copy/reset/readback replacement use in-page confirmation and local backups.

## Real floor and calibration
Use paper house labels or low-tack tape on a clear supervised floor, away from edges, people and pets. Mark equal squares; choose a modest scale based on the observed short forward test. Start orientation must match the map. Use the adult settings to tune forward/left/right times (80–1000 ms) and motor speed (15–45). Defaults are 350/280/280 ms at speed 30, NOT calibrated distances or angles. Upload settings, explicitly test, observe and reset to START. Surface/battery/wheel variation requires rechecking. Each run requires supervision and reset checkboxes. Do not use a desk or stairway.

Calibration is inside the root block's standard serialized `data` string; it travels with the actual workspace and generated Python. It is not an invented SDK field or firmware envelope. Any change requires uploading again. Each explicit test uses a new message nonce; identical writes are not relied on.

## Hardware is the game
After upload acknowledgment, Start arms a fresh session but does not start motors. Each Drive button sends only ONE index from the uploaded route. The callback on the device chooses and performs that route step. The same visual move on the floor represents the map move; it is not a reward unrelated to gameplay.

After an estimated cooldown, the UI asks the child whether the real movement matched the dashed planned position. Sending, waiting or playing an animation does NOT advance confirmed position, award deliveries or unlock missions. The child explicitly confirms. “Not quite” ends the run, requests STOP and returns to tuning. No correction or motion is replayed automatically. Delivery confirmation includes seeing the light signal and placing the paper parcel. Completion is explicitly user-observed, not sensor-verified.

## Runtime and safety
Uses supplied Crowbot compatibility profile `integem-crowbot-mqtt-v1`. The module generates final `def MQTT(mqtt_msg, voltage):` with two-space indentation. Firmware supplies command import/terminal return. Names `moveup_left/right`, `movedown_left/right`, `stopmove_left/right`, `light_turnon/off` come from the supplied contract; the vocabulary is replaceable in model.ts. Routes and repeats compile into a device-side step table, rather than one long blocking callback; repeat semantics are expanded for one-step supervision.

Every movement has paired motor stops in nested `finally` cleanup. Device-side guards reject wrong program tags, old run IDs, duplicate/out-of-order steps, and concurrent callback actions. Tags are routing aids, not security or device integrity proofs. Test/motion commands are defined by THIS uploaded program, not asserted as built-in firmware commands. Upload/readback b/m framing remains entirely host-owned.

STOP has priority over an unsent command waiting for its rate slot; an accepted GATT write cannot be preempted. Device-side waits may take longer than their requested duration and cannot be guaranteed interruptible. Cleanup is best effort, not certified safety. A broken library, stalled firmware, power fault or lost connection can prevent stopping. Attend to the physical robot and use its power switch if necessary. No distance/turn accuracy, automatic obstacle sensing, step acknowledgment or physical execution confirmation is claimed.

The game sends no automatic route stream. Step buttons cannot queue multiple moves. Hidden/disposed modules start no hardware operations. Hiding ends a delivery and invalidates play authorization; returning requires attending to the robot. Closing never disconnects the shared device. Accepted uploads remain host-owned. Upload cancellation explicitly warns that it disconnects shared BLE and is not rollback.

## Real upload and readback
Upload freezes a Blockly snapshot, generates from that snapshot and calls sdk.device.upload with kind micropython, source, workspacePolicy replace and raw workspace. watchUpload/waitForUpload drive status. Only device-confirmed allows a matching current program/connection to start. Reconnect, reopen, semantic edits, timing changes or another client's upload invalidate the receipt. Moving blocks visually does not.

Grown-up tools retains get_device_block_xml sent through sdk.device.send after subscription. ReadSession buffers streamed UTF-8/JSON, filters connection/session/sequence, handles 5 s first-byte / 5 s idle / 60 s total timeouts and a 256 KiB cap. Conflicting activity cancels readback; this is not an exclusive transaction. Unknown block sets are preserved, not silently imported. Local backup is distinct from actual notifications. Code recovered from blocks is labeled generated, not device source.

## Persistence and coexistence
Independent module ID and parcel.v1.* storage keys. Does not replace Flappy or delete old data. Course progress, three drafts and separate local metadata/backups are kept. Upload receipt metadata is diagnostic only, never trusted across sessions. Each module has its own editor, but the physical device has one callback: after switching from Flappy, upload the intended game's program again. Unknown future schemas are protected.

## Build and verify
Full TypeScript source in source/crowbot-parcel-pals. Node 22, TypeScript 5.8.3, Blockly 8.0.0, Playwright. Installed release has all local dependencies/media and no npm/server/network requirement. Native fullscreen is optional; full-window play does not depend on it. Third-party .cur/GIF/audio retained; sound playback off. Requires the actual updated 2026-09-22 iCreator resource-import host, not just a changed prompt.

Development: npm ci; npm run build; npm test; npx playwright install chromium; npm run test:browser. See VERIFICATION.md for actual test evidence. A contract-derived local browser harness and mocked SDK are NOT actual iCreator App/Web, Blob URL mapping, official module-kit or physical Crowbot certification.


## 1.1.0 — clear driving controls and observable preflight

The 1.0.0 delivery screen only bound a Drive button. Arrow keys did not send anything, and Start merely armed the uploaded route. This was a discoverability/input omission, not evidence that the user's Bluetooth stack or System Prompt was broken.

After this module update, **upload the route again**. Existing `parcel.v1.*` progress, backups and Blockly timing data are retained. Old upload receipts are never reused. Flappy remains unchanged.

### Connect → Upload → Blink → Drive

A prominent light-only check appears immediately after upload. Click **Blink Bolt's light**, observe the real robot, then choose **Yes — I saw two blinks** or **No — nothing happened**. Upload acknowledgment and a returned write do NOT automatically pass this check. The check never starts or stops a motor. This observation is scoped to the current program/connection only, not persisted as hardware certification. Reopening, changing the program/settings/connection or an observed foreign upload requires a new upload and check.

A no-light report provides re-upload, correct-device/power and Grown-up tools guidance. If the light responds but wheels do not, check the real motor power/library and short-action settings with an adult; the browser cannot diagnose this from a GATT write. The delivery screen distinguishes **No movement at all** from **Moved, but not to the right place**.

### Two clearly named control contexts

- **Delivery controls:** ↑ executes the next forward block; ← or → executes the matching next turn block. Space/Enter executes any next programmed step, including deliver and park. Wrong-direction input gives a specific cue and sends nothing. The next direction is highlighted. ↑ means forward in the robot's heading, not north on the map. ↓ or Escape requests STOP and ends this run. A movement is never initiated by opening this page.
- **Try the arrow controls first (optional):** an explicit Practice panel on the setup page permits short forward/left/right tests independent of the route. Arrow keys match the screen pad. Down/Space/Escape request STOP. No mission progress is earned. Each motion clears the START-position checkbox. Close Practice, reposition Bolt and confirm START before delivering.

Each tap is bounded. Key-repeat events and rapid extra taps do not form a motion queue. Keyboard commands are ignored in the Blockly editor, text/number fields, dialogs, Grown-up tools, or hidden pages. Space/Enter cannot silently click the observation Yes button; observations require an explicit on-screen click. A wrong key or waiting state is visible rather than silent.

### Compact commands, unchanged upload/readback

The new module-owned runtime uses exactly 19 ASCII bytes: `p2` + 8-hex program tag + `a/s/t` + 6-hex nonce + 2-hex action index. `a` arms the route without motion, `s` executes an uploaded route step, `t` selects an explicit short test (index 3 is light-only). Plain `stop` is unchanged. The matching generated callback validates these messages. Old verbose runtime packets are rejected by the new callback, so re-upload is mandatory.

This keeps manual game packets below 20 bytes without assuming MTU negotiation. It is a compatibility precaution, not proof that packet truncation caused the user's reported failure. No packet-fragment retries, automatic motor replays or host SDK methods were added. The host still owns original b/m upload and `get_device_block_xml` notification readback. Program tags are routing checks, not authentication/integrity proofs.

The visible command details identify no movement requested, sending, returned GATT write, and failed write. Latest bounded runtime text/length is available in Grown-up tools. No device source/storage dump or raw telemetry is logged automatically.
