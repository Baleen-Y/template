# Verification — Flappy BLE 4.0.1

Source commit: 1d33fcec1a64c547b469dfec048dcd85d3c30d46

Strict TypeScript build and production unit/protocol/packaging tests passed.

Browser: 140.0.7339.186

headless Chromium; real Blockly 8; mocked iCreator SDK; no real hardware/host/GPU certification

- new course: blank student workspace, read-only example, hidden rescue copy, locked stages
- canceled Bluetooth chooser remains retryable
- example copy still requires upload; in-page confirmation works
- real Blockly snapshot is paired with generated Python in production SDK upload path
- semantic block edits invalidate upload authorization
- notification readback restores editable Blockly, never treats cached data as device data, re-upload required
- stage 1: real game reaches target, priority STOP sent, completion unlocks next lesson
- stage 2: real game reaches target, priority STOP sent, completion unlocks next lesson
- stage 3: real game reaches target, priority STOP sent, completion unlocks next lesson
- no per-tap BLE commands and no ordinary event after terminal STOP
- reopen preserves course drafts/progress but never trusts an old upload receipt
- 700px responsive layout has no page-width overflow
- other module upload invalidates the current stage receipt
- hidden module initiates no BLE sends
- zero uncaught browser errors and zero external runtime network requests
- missing-SDK state explains how to open module and disables hardware play
- actual Blockly renders and drags with PNG/SVG-only media
- native grab and delete cursors
- no .cur requests or injected cursor URLs
- zero failed asset requests and uncaught browser errors

The reported .cur rejection is covered by a negative regression test. Every final ZIP member is checked against a conservative local path/extension policy. Actual iCreator App/web import, official module-kit validator and physical BLE hardware: NOT TESTED.
