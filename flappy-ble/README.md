# Flappy BLE

A Flappy Bird-style iCreator module with Bluetooth command output.

## Default event commands

- Game start: `moveup`
- UP action: `left`
- DOWN action: `right`
- Game over / collision: `stop`

The four text commands are editable in the module and persisted with iCreator SDK storage.

## Bluetooth profile

This release defaults to the verified iCreator compatibility profile:

`integem-crowbot-mqtt-v1`

The host owns the device chooser and BLE connection. The module does **not** use `navigator.bluetooth`.

If you need a different BLE device, change the connection code to `generic-ble-v1` only after obtaining the device's real service/characteristic UUIDs and write mode from its specification.

## Usage

1. Import the `flappy-ble` folder/ZIP in iCreator Modules.
2. Allow requested device permissions.
3. Click **Connect Bluetooth** and choose a compatible device.
4. Click **Start Game**.
5. Press the on-screen UP / DOWN buttons or keyboard arrow keys.
6. Hitting a pipe or the floor ends the round and sends the stop command.
7. Disconnect only with the explicit **Disconnect** button.

## Notes and limitations

- A successful GATT write means the command was sent; it does not prove the device executed the command.
- The game never silently reconnects or replays a failed hardware command.
- Closing the module does not disconnect the shared device.
- No external network, CDN, WebSocket, WebUSB, Web Serial, or direct browser Bluetooth API is used.
- Hardware execution was not tested by ChatGPT because no physical device is available in this environment.
