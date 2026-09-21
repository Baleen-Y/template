# Flappy BLE Blockly — v2.0.0

A directly importable iCreator module that turns the Flappy-style game into a Blockly-programmable game.

## What changed from v1

The old version used four text inputs for fixed BLE commands. v2 keeps the same module ID (`flappy-ble`) so it can be installed as an update, but the game logic now lives in a real bundled Blockly workspace.

The Blockly program can react to:

- game start
- UP press
- DOWN press
- pipe passed
- game over

Actions can:

- flap or dive the bird
- send exact BLE text
- change gravity
- change pipe gap
- change pipe speed
- add/subtract score
- wait
- repeat nested actions
- run nested actions based on score

The starter blocks preserve the original behavior:

- game start -> send `moveup`
- UP -> flap + send `left`
- DOWN -> dive + send `right`
- game over -> send `stop`

## Blockly runtime

Blockly 13.3.0 is vendored locally at:

`assets/vendor/blockly.min.js`

No CDN is used by the installed module. The repository workflow `.github/workflows/vendor-flappy-blockly.yml` only exists to pin and copy the upstream runtime into the release directory during repository development.

The runtime module itself has no external network dependency.

## Workspace persistence

The editable Blockly structure is stored with the iCreator SDK, not localStorage/IndexedDB.

- `workspace.v2`: raw Blockly workspace JSON from `Blockly.serialization.workspaces.save`
- `workspace.meta.v2`: local version/provenance metadata
- `bestScore`: best game score

At the start of every round the current workspace is frozen and loaded into a separate headless Blockly workspace. Later edits therefore affect the next round, not an already running round.

## Bluetooth behavior

The module uses the host-supported Blockly-compatible connection profile:

`integem-crowbot-mqtt-v1`

It does not use `navigator.bluetooth`.

The `send BLE command` block calls `sdk.device.send` with the exact text in the block. Each send refreshes the shared device state first. Failed or BUSY sends are shown in the log and are not silently replayed.

The module does **not** upload a new Crowbot firmware callback. Blockly in this module programs the browser game's event logic and the commands it sends to an already compatible device. Therefore v2 does not claim that game-physics blocks change firmware behavior.

## Import / update

Import the `flappy-ble/` folder directly, or package it with the iCreator module packer if the host repository is available.

Because the manifest ID remains `flappy-ble` and the version is now `2.0.0`, it is intended to update the previous release.

## Verification scope

Repository/static checks can verify:

- manifest shape and permissions
- local asset references
- JavaScript syntax
- Blockly workspace serialization API presence in the vendored runtime
- no runtime CDN/external network URL in the module release files

Physical BLE behavior still requires a real compatible device. A successful GATT write is not proof that the device executed the command.

No physical-device test is claimed here.
