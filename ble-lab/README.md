# BLE Lab

BLE Lab is a configurable BLE GATT debugging module for the iCreator Modules host.

## Release layout

```text
ble-lab/
  module.json
  index.html
  assets/
    main.js
    style.css
  README.md
```

The folder is ready to place directly under:

```text
<project>/modules/ble-lab/
```

No npm install, development server, CDN, external API, backend, WebSocket, MQTT, Web Serial, WebUSB, or direct `navigator.bluetooth` usage is required.

## Requirements

BLE Lab does not know your hardware protocol.

Before LIVE testing, obtain the actual values from the hardware/firmware documentation:

- BLE GATT service UUID
- write characteristic UUID, if used
- notify characteristic UUID, if used
- read characteristic UUID, if used
- write mode
- maximum write size expected by the device/protocol
- packet framing, commands, CRC, delimiters, and acknowledgement semantics where applicable

All UUIDs are intentionally blank on first use. Do not invent UUIDs or commands for unknown hardware.

## LIVE mode

LIVE mode uses the host-injected `window.icreator` SDK.

The module:

- waits for `window.icreator.ready()`
- observes shared device state via `device.watchState()`
- receives future notifications through `device.onData()`
- connects with the `generic-ble-v1` profile
- sends either text or byte arrays
- supports explicit read when the active connection includes a read UUID
- uploads fixed packet sequences using `artifact.kind = "ble-packets"`
- persists configuration and UI preferences through SDK storage
- never uses an independent Bluetooth connection
- never disconnects automatically when the module closes

If opened in a regular browser without the host SDK, BLE Lab shows **Open this module in iCreator** and keeps LIVE hardware controls unavailable.

## Demo mode

Demo mode is optional and must be entered explicitly.

It is labeled **SIMULATED**. It uses only module-local state and does not call iCreator hardware SDK methods.

Demo mode can:

- simulate a device connection from the form values
- echo manually sent payloads into the receive log
- simulate packet-transfer progress

Demo results are not hardware verification. When leaving Demo mode, simulated receive entries are removed and BLE Lab reloads the real shared state when the SDK is available.

## Connection configuration

A valid LIVE connection requires:

- one full 128-bit service UUID
- at least one full 128-bit write, notify, or read characteristic UUID

Optional blank UUID fields are omitted from the SDK request.

If another module already owns a shared connection with a different configuration, the host can report `BUSY`. BLE Lab does not silently disconnect it. Use the explicit **Disconnect** action before switching configurations.

Every new shared connection can have a different `connectionId`. BLE Lab always gets the current target from shared state instead of intentionally caching a stale target.

## Send

Send supports:

- Text
- HEX
- no suffix
- LF
- CRLF

HEX accepts whitespace-separated or compact two-digit byte pairs.

Before sending, BLE Lab checks the final UTF-8/binary byte length against the active connection's `maxWriteBytes`.

Manual send is not automatically split into multiple packets.

A successful GATT write is transport completion only. It does not prove the device executed a command.

## Receive and Read

The Receive panel shows:

- timestamp
- connection ID
- raw HEX
- UTF-8 convenience view

The log keeps at most 500 entries.

**Pause autoscroll** only pauses scrolling; it does not stop notification subscription.

Read is enabled only when the active shared generic GATT configuration contains a read characteristic UUID.

Device text is inserted using `textContent`, not executable HTML.

## Packet Transfer

Enter one HEX packet per line.

BLE Lab validates:

- 1–8,192 packets
- nonempty packet lines
- each packet <= active `maxWriteBytes`
- total bytes <= 128 KiB
- `intervalMs` between 0 and 1000

LIVE transfer calls the generic upload API and displays host progress.

After transport completion, BLE Lab displays:

```text
Sent — unconfirmed
```

That wording is intentional. No device acknowledgement protocol is supplied here, so BLE Lab does not claim device-side success.

Canceling an accepted upload calls `device.cancelUpload(jobId)`. The current SDK behavior disconnects the shared device to stop queued writes. An in-flight packet may already have been written; cancellation is not rollback.

## Shared-state test with two modules

To test that two modules observe the same host connection:

1. Copy `ble-lab/` to `ble-lab-observer/`.
2. In the copied `module.json`:
   - change `id` to `ble-lab-observer`
   - change `name` to `BLE Lab Observer`
3. Install both folders in the same project.
4. Open BLE Lab and connect to your test hardware using its real GATT configuration.
5. Switch to BLE Lab Observer.
6. Confirm the same shared device, status, connection ID, and GATT configuration appear.
7. Explicitly disconnect in BLE Lab Observer.
8. Switch back to BLE Lab and verify the shared state is disconnected.

Do not install two modules with duplicate manifest IDs.

Do not auto-send a test command to unknown hardware.

## Error handling

The UI surfaces host/device errors including common cases such as:

- `USER_CANCELED`
- `UNSUPPORTED`
- `NOT_CONNECTED`
- `STALE_CONNECTION`
- `BUSY`
- `PERMISSION_DENIED`
- `PAYLOAD_TOO_LARGE`
- `PROJECT_CHANGED`

Hardware operations are not automatically replayed after a failure.

## Verification status

This repository example is a release-style implementation based on the iCreator Modules API 1.1.0 contract.

It has **not** been claimed to pass physical BLE hardware testing because no hardware model, UUID set, command protocol, or test device was supplied.

If you have the iCreator repository locally, validate/package with the repository tools when available:

```bash
node tools/module-kit/validate.cjs ble-lab
node tools/module-kit/pack.cjs ble-lab
```

A mock/Demo UI check does not replace real-device testing.
