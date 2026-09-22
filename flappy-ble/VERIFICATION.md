# Verification — Flappy BLE 4.0.2

Source commit: 85e7a400a0797fce204acf2faf16495e4e01995d

Strict TypeScript 5.8.3 build; 33 production-code unit/protocol/resource checks passed.

Browser: 140.0.7339.186

headless Chromium; real Blockly 8; mocked iCreator SDK; no real hardware/host/GPU certification

- new course: blank student workspace, read-only example, hidden rescue copy, locked stages
- canceled Bluetooth chooser remains retryable
- example copy still requires upload; in-page confirmation works
- real Blockly snapshot is paired with generated Python in production SDK upload path
- semantic block edits invalidate upload authorization
- specific block mismatch feedback and Fit my blocks work in the real editor
- notification readback restores editable Blockly, never treats cached data as device data, re-upload required
- stage 1: real game reaches target, priority STOP sent, completion unlocks next lesson
- stage 2: real game reaches target, priority STOP sent, completion unlocks next lesson
- stage 3: real game reaches target, priority STOP sent, completion unlocks next lesson
- no per-tap BLE commands and no ordinary event after terminal STOP
- reopen preserves course drafts/progress but never trusts an old upload receipt
- 4.0.1-compatible progress schema and all three draft keys survive the patch update
- 700px responsive layout has no page-width overflow
- other module upload invalidates the current stage receipt
- hidden module initiates no BLE sends
- zero uncaught browser errors and zero external runtime network requests
- missing-SDK state explains how to open module and disables hardware play
- complete Blockly media loads at a nested module root, including all three .cur and audio/GIF data
- exact upstream Blockly renders and drags; custom cursors retain native fallbacks
- static CSS and dynamic Blockly CSS resolve to the module-owned media directory
- Chromium decodes the custom .cur image, not just its URL
- resource diagnostics verifies every bundled media file by length and SHA-256
- unknown-extension and extensionless fixture data can be fetched as application/octet-stream
- student Fit control works; zero failed local resource requests, uncaught errors or external requests

Resource-test scope: headless Chromium with a contract-derived nested-path HTTP harness; not actual iCreator import or Blob URL mapping.

Packaging uses the supplied 2026-09-22 contract's resource policy and keeps the canonical flappy-ble/ ZIP root. Unknown extensions are retained as data; filesystem/path/secret/duplicate/size protections remain.

Actual iCreator desktop/web import, the target host shared module-kit validator, host-owned Blob URL remapping, and physical BLE hardware: NOT TESTED. The target host repository/validator was not available. This package requires the installed host resource-import update, not merely a changed prompt.
