declare global {
  interface Window { icreator?: any; }
}

type Commands = { start: string; up: string; down: string; stop: string };
type GameMode = 'ready' | 'running' | 'over';
type Pipe = { x: number; width: number; top: number; bottom: number; scored: boolean };

type GameState = {
  mode: GameMode;
  score: number;
  best: number;
  lastFrame: number;
  spawnTimer: number;
  stopSent: boolean;
  bird: { x: number; y: number; vy: number; r: number };
  pipes: Pipe[];
};

const DEFAULTS: Commands = {
  start: 'moveup',
  up: 'left',
  down: 'right',
  stop: 'stop'
};

/**
 * Source reference for the shipped module.
 * Runtime code is compiled/bundled to ../../flappy-ble/assets/main.js.
 *
 * Important BLE rules:
 * - Use window.icreator only.
 * - Default connection profile: integem-crowbot-mqtt-v1.
 * - Refresh device state before every send so stale connection IDs are not reused.
 * - Never auto-replay failed commands.
 * - Keep manual control sends <= 10/sec.
 */
export async function sendGameCommand(
  sdk: any,
  text: string,
  label: string
): Promise<boolean> {
  if (!text.trim()) return false;

  try {
    const state = await sdk.device.getState();
    const target = state.currentDevice;
    if (!target || state.activity) return false;

    await sdk.device.send({
      deviceId: target.deviceId,
      connectionId: target.connectionId,
      text
    });

    console.info(label, text);
    return true;
  } catch (error) {
    console.error(label, error);
    return false;
  }
}

export async function connectDefaultDevice(sdk: any): Promise<void> {
  await sdk.device.connect({ profileId: 'integem-crowbot-mqtt-v1' });
}

export { DEFAULTS };
