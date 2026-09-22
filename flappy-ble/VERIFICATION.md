# Verification — Flappy BLE 4.0.0

Source commit: c0c1ae3eafb025ab0983c655a239aa0c5b5ac27e

Strict TypeScript build and production-code unit/protocol tests completed successfully.

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

Actual iCreator desktop/web host, physical BLE hardware and real-GPU compatibility: NOT TESTED. No host module-kit validator is present in this repository.
