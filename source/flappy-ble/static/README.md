# Flappy BLE — Three-stage Quest 4.0.1

A directly importable iCreator module. Device Blockly programs the physical Crowbot; it is not a browser game-block interpreter.

## Student workflow

Choose the unlocked stage → study the read-only Blockly example → assemble your own device program → check the checklist → connect Crowbot → upload this exact program and workspace → play the stage. Clearing a stage unlocks the next one.

| Stage | Game | Device lesson |
|---|---|---|
| 1 · First light | Pass 3 pipes; gap 235; speed 145; gravity 850 | `start` turns the light on. `stop` stops both motors and switches the light off. Events and action order. |
| 2 · Signal patterns | Pass 5 pipes; gap 195; speed 180; gravity 1000 | `pipe` repeats a 100 ms off/on pattern twice. Learn repeats and timing. No moving-motor action. |
| 3 · Robot celebration | Pass 7 pipes; gap 160; speed 220; gravity 1150 | Random light per pipe; at scores 3 and 6 perform two short 35-speed, 120 ms motor pulses, each followed by motor stops and 120 ms rest. Learn coordinated actions and safe stops. |

Pipes spawn 2.6 seconds apart. In stage 3, a milestone replaces that pipe's normal feedback rather than queueing both. The final target ends the round and requests STOP. UP/DOWN and Space affect only the game and do not produce BLE traffic.

## Examples are not pre-filled answers

Every new stage starts with one empty device-program root. A separate, real Blockly read-only workspace shows the completed example. The stage toolbox exposes only the needed vocabulary. The checker validates message names, action order, values and repeat nesting; it ignores positions/IDs and permits message handlers in a different order.

“Stuck? Open a hint” explains the current lesson. Only inside that help section is “Still stuck? Copy completed example.” Copying requires an in-page confirmation, backs up current work, and records example-assisted progress without blocking completion. “Start over (blank)” and “Restore local backup” are separate recovery actions. No native `window.confirm` is used.

## Upload is a real prerequisite

The Start button is gated by a valid current-stage solution and a `device-confirmed` upload result on the current project/device/connection. Changing semantic blocks, selecting another stage, reconnecting, reopening, or observing another client's upload invalidates authorization. Saved upload metadata is diagnostic only; it is never trusted to enable a future session. Moving a block without changing its program does not require a needless upload.

Upload freezes one actual `Blockly.serialization.workspaces.save` snapshot and generates Python from that same snapshot. It calls the implemented `sdk.device.upload` with `kind: micropython`, `workspacePolicy: replace`, source and the matching raw workspace. Editing during the accepted upload cannot mutate its payload and will require a new upload. Progress uses `watchUpload`/`waitForUpload`; no simulated hardware-success timer is used in the release.

A confirmation means the host reported transfer/reload acknowledgement. It is not proof that the robot executed every action, nor is it proof that the installed firmware matches the inspected sources.

## Device and firmware prerequisites

This adapter targets the inspected Crowbot ESP32 compatibility contract through `integem-crowbot-mqtt-v1`; it is not a universal Bluetooth or Drone program uploader. Function examples are those supplied in `MODULE_SYSTEM_PROMPT(3).md`: `light_turnon`, `light_turnoff`, `light_random`, `moveup_left/right`, `movedown_left/right`, `stopmove_left/right`, and `time.sleep_ms`.

The Python entry is `def MQTT(mqtt_msg, voltage):` with two-space indentation. The existing firmware adds its command-library import and terminal return. The generator emits final Python; no legacy colon-converter is used. The vocabulary map is isolated in `source/flappy-ble/src/model.ts` and can be replaced for a teacher-maintained compatible command library without changing the transport. New names are not claimed to exist in shipping firmware.

The module never implements b/m framing itself and never directly accesses browser Bluetooth, MQTT, Web Serial, WebUSB, workers, popups or external services. The host owns connections, transfer pacing and acknowledgements.

## STOP behavior and physical limitations

Only one ordinary event is pending. A terminal STOP drops it, including an event selected but still waiting for the send interval. At most one already-accepted write must finish first. No failed/BUSY operation is automatically retried. The UI exposes Send STOP and blocks another round after a failed stop attempt.

Device-side blocking waits cannot be interrupted by the browser. Stage 3 actions are brief and self-stopping, but this is not a certified safety mechanism. Supervise the robot in a clear area away from edges. Bluetooth loss, firmware/library faults, device power loss and physical effects cannot be diagnosed from a GATT write receipt.

Hiding a module cancels the round and timed sends; it does not try to send while hidden. On return, attend to the robot, use Send STOP and upload again. Closing/disposal never disconnects other modules' shared connection. Explicit upload cancellation can disconnect the shared device and leave partial workspace/program state; the UI explains this before cancellation.

## Read blocks from device

The live SDK notification listener is registered before the exact `get_device_block_xml` request. The bounded stream parser filters device/connection/project, supports split UTF-8 characters and JSON, and rejects mixed or unrelated traffic. Limits: 256 KiB; 5 s first-byte; 5 s idle; 60 s total. Disconnect, project changes, hiding, disposal and conflicting shared activity cancel the read. These are module-side guards, not an exclusive multi-client transaction guarantee.

Raw received text is kept in memory and persisted when within storage limits. It is validated against this block set and a temporary Blockly workspace before explicit replacement of current edits. Local backup remains separate and clearly labeled. After restoring, the code pane says “Generated from recovered blocks,” not “Device source.” Actual mqtt.py/main.py readback and arbitrary Python-to-Blockly conversion are not claimed.

## Upgrade and persistence

Same manifest ID `flappy-ble`, version `4.0.0`. Update the existing module from the built `flappy-ble/` folder or ZIP and grant the listed permissions when the host prompts. Do not import the `source/` project as a module.

Course keys are separate: `course.v4.progress`, `course.v4.stage.1/2/3`, `course.v4.backup`, `course.v4.upload.1/2/3`, and `course.v4.readback.raw`. Existing v3 workspace/metadata/high-score keys are not deleted or reinterpreted as lesson programs. Stage drafts have a 64 KiB module limit; metadata is stored separately. Storage failures are visible and current-window edits remain available. Unknown progress schemas are not overwritten.

## Source, build and tests

`source/flappy-ble/src/` contains the full TypeScript implementation, not a partial source reference. Runtime uses locally compiled ES modules and the repository's pinned Blockly 8.0.0 core. All media are local and sounds are disabled. No npm installation, development server or internet is needed by the installed release.

For development in `source/flappy-ble`: `npm install` (or `npm ci` once the checked-in lock exists), `npm run build`, `npm test`, then `npx playwright install chromium` and `npm run test:browser`. Node 22 is used for TypeScript build/test tooling. The GitHub workflow compiles, runs production-code unit/protocol tests, tests the actual bundled Blockly in headless Chromium with an explicitly mocked iCreator SDK, and only then commits the built release on the feature branch.

Local checks include strict TypeScript compilation, production generator/Python syntax checks, exact upload/readback payload loops, parser failure/timeout cases, priority-STOP queue pressure, progress ordering and actual game simulation goals. Browser-test evidence is written by the workflow, not assumed. Physical Crowbot and the actual iCreator App/web module containers remain untested here. See `VERIFICATION.md` in a CI-built release and the workflow logs for the exact checks/environment. No host module-kit validator was available in this repository.


## 4.0.1 import packaging fix

The previous ZIP included Blockly legacy Windows cursor assets (.cur), which the iCreator importer rejected. The build now cleans the media directory and copies only PNG/SVG images. Unused audio and GIF files are omitted because the editor has sounds disabled. Eight legacy cursor URL declarations in the pinned Blockly 8.0.0 bundle are replaced with native grab/grabbing/no-drop cursors; original license notices are retained.

A release-path policy and negative regression tests reject unsupported files, duplicates and symlinks before ZIP delivery. This is a conservative module-owned packaging check, not the unavailable official host validator. The curriculum, stage drafts, progress keys, upload/readback and priority STOP behavior are unchanged.
