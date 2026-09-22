# Verification — Flappy BLE 5.0.0

Source commit: 88f4a8b57099a620073633dbf5a67ec4b3d2a32a

Strict TypeScript 5.8.3 build; 40 production-code unit/protocol/resource checks passed.

Browser: 140.0.7339.186

headless Chromium; real bundled Blockly and production ES modules; mocked iCreator SDK; no physical device or real iCreator container certification

- quiet child-facing mission map, without editor/game/diagnostics crammed onto the welcome screen
- building is a separate full-size workspace with a read-only example, blank student program and no hardware action on load
- copy remains last-resort help with in-page confirmation; connection cancellation is retryable; physical upload is required; light lesson contains no motor starts or stops
- optional Try Bolt test uses the real SDK path only on an explicit click and finishes with STOP
- real semantic Blockly edits invalidate upload authorization and show one actionable mismatch instead of a diagnostic wall
- teacher tools retain live fragmented notification readback and editable replacement, with a new upload still required
- flight fills the complete module viewport automatically; denied native fullscreen keeps full-window play; pause freezes physics and sends STOP before resume
- mission 1: distinct theme, genuine input-only game completion, star rewards, terminal STOP, and next mission unlock
- mission 2: distinct theme, genuine input-only game completion, star rewards, terminal STOP, and next mission unlock
- mission 3: distinct theme, genuine input-only game completion, star rewards, terminal STOP, and next mission unlock
- robot interaction is low-frequency mission progress, not finger-press spam; moving lesson uses self-stopping pulses and paired final parking
- small-screen learning uses example/editor tabs; no horizontal page overflow; reopening keeps drafts and progress but never trusts a stale upload receipt
- another module upload invalidates play permission; hiding during countdown cancels before any device command and requires attention on return
- v4 unlocked progress migrates without changing old draft/progress keys; new lesson drafts are kept separately
- missing SDK stays honest; no browser-only hardware impersonation in release; no external requests, missing resources or uncaught browser errors
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
