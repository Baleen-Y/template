# Flappy BLE Device Blockly — v3.0.0

Flappy BLE v3 fixes the direction of the Blockly integration.

The browser game and the physical-device program are now separate layers:

- **Flappy game** runs in the module and sends runtime BLE event strings.
- **Device Blockly** generates the Crowbot Python callback that is uploaded to the physical device.
- **Device readback** retrieves the device's saved Blockly workspace and restores it into the same editor.

Dragging a device block does not execute hardware. Hardware behavior changes only after an explicit **Upload to Device**.

## Default game events

The browser game sends these exact strings:

- game start -> `moveup`
- UP -> `left`
- DOWN -> `right`
- game over -> `stop`

The default device Blockly program maps them to the original Crowbot command-library examples:

- `moveup` -> left + right motor forward
- `left` -> stop left motor + move right motor forward
- `right` -> move left motor forward + stop right motor
- `stop` -> stop both motors

## Device Blockly blocks

The v3 starter toolbox contains:

- Crowbot device program
- when game message ...
- device light on/off/random
- left/right motor forward/backward with speed
- stop left/right motor
- wait milliseconds

The block vocabulary is module-owned teaching content. The actual Crowbot function-name mapping is isolated in:

`assets/crowbot-adapter.js`

If a teacher-maintained firmware library renames a function, change the adapter/generator mapping rather than the BLE transfer framing.

## Generated Crowbot source

The module generates a final callback shaped like:

```python
def MQTT(mqtt_msg, voltage):
  if mqtt_msg == "moveup":
    moveup_left(50)
    moveup_right(50)
```

If delay blocks are used, the generator adds `import time` and emits `time.sleep_ms(...)`.

The module sends the final Python directly. It does not use the historical colon-string converter.

## Upload loop

Upload is an explicit user action.

1. Save a frozen Blockly workspace snapshot.
2. Generate Python from that exact frozen snapshot.
3. Verify a compatible `integem-crowbot-mqtt-v1` connection.
4. Call `sdk.device.upload` with:
   - `kind: 'micropython'`
   - generated source
   - `workspacePolicy: 'replace'`
   - the matching raw workspace snapshot
5. Observe `watchUpload` and await `waitForUpload`.

The host keeps the existing Crowbot b/m transport, pacing and ACK handling. The module does not manually send reserved `b:` or `m:` framing.

An upload ACK is reported as transfer/reload acknowledgement, not proof that every physical action behaves correctly.

## Read from device

Readback uses the current legacy request:

`get_device_block_xml`

The module:

- subscribes to `sdk.device.onData` before sending the request
- filters by deviceId, connectionId and project session
- uses streaming UTF-8 decoding
- limits the workspace to 256 KiB
- uses a 5-second first-byte timeout
- uses a 5-second idle timeout
- uses a 60-second absolute timeout
- rejects unknown mixed telemetry instead of silently stripping it
- parses one complete top-level JSON workspace
- stores the raw parsed workspace as a local readback backup when storage permits
- validates the downloaded blocks in a temporary Blockly workspace
- backs up current edits before replacement
- asks before replacing the current editor
- regenerates Python and labels it **Generated from recovered blocks**

The protocol does not provide actual `mqtt.py` source readback. The code shown after readback is regenerated from the recovered blocks.

## Local storage

v3 uses separate versioned keys:

- `deviceWorkspace.v3`
- `deviceWorkspace.meta.v3`
- `deviceWorkspace.backup.v3`
- `deviceReadback.raw.v3`
- existing `bestScore`

The v2 browser-game Blockly storage is not reused as the device workspace.

## Bluetooth profile

v3 targets the inspected Crowbot ESP32 compatibility path and uses:

`integem-crowbot-mqtt-v1`

It does not use `navigator.bluetooth`, direct GATT, WebUSB, Web Serial, MQTT, WebSocket, a custom backend, or a custom b/m implementation.

## Bundled runtime

Blockly 8.0.0 is bundled locally in:

- `assets/vendor/blockly_compressed.js`
- `assets/vendor/blocks_compressed.js`
- `assets/vendor/en.js`

No CDN or external runtime dependency is required.

## Physical validation status

The module contains the real SDK upload and notification-readback implementation.

Static checks can verify release structure, permissions, local assets, syntax and the presence of the real upload/readback paths. A physical Crowbot was not available in the development environment, so real-device upload/readback comparison and motor/light behavior remain pending hardware validation.

Do not interpret a successful transfer ACK as full hardware behavior certification.
