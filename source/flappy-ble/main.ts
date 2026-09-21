declare global {
  interface Window {
    icreator?: ICreatorSdk;
    Blockly: any;
    FlappyBlockly: {
      blockSetId: string;
      blockSetVersion: string;
      generatorVersion: string;
      eventTypes: Record<GameEventName, string>;
      toolbox: unknown;
    };
  }
}

type GameEventName = 'start' | 'up' | 'down' | 'pipe' | 'gameover';

type DeviceTarget = {
  deviceId: string;
  connectionId: string;
};

type DeviceState = {
  currentDevice: (DeviceTarget & {name: string; profileId: string}) | null;
  activity: null | {kind: string};
};

interface ICreatorSdk {
  ready(): Promise<{apiVersion: string; platform: string}>;
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
  };
  device: {
    connect(options: {profileId: string}): Promise<DeviceState>;
    disconnect(target: DeviceTarget): Promise<void>;
    getState(): Promise<DeviceState>;
    send(request: DeviceTarget & {text: string}): Promise<void>;
    watchState(callback: (state: DeviceState) => void): Promise<() => void>;
  };
  lifecycle: {
    onVisibilityChange(callback: (visible: boolean) => void): () => void;
    onDispose(callback: () => void): void;
  };
}

/**
 * TypeScript source reference for Flappy BLE Blockly v2.
 *
 * The shipped release is compiled/bundled JavaScript in flappy-ble/assets/.
 * The runtime architecture intentionally keeps three artifacts separate:
 *
 * 1. Blockly workspace JSON: editable game logic.
 * 2. Browser runtime state: a frozen workspace snapshot for one game round.
 * 3. BLE text commands: exact strings emitted by send-BLE blocks.
 *
 * This version does not upload firmware source to the device.
 */
export async function sendBleCommand(
  sdk: ICreatorSdk,
  text: string
): Promise<boolean> {
  const command = text.trim();
  if (!command) return false;

  try {
    const state = await sdk.device.getState();
    if (!state.currentDevice || state.activity) return false;

    await sdk.device.send({
      deviceId: state.currentDevice.deviceId,
      connectionId: state.currentDevice.connectionId,
      text: command
    });
    return true;
  } catch {
    return false;
  }
}

export function freezeWorkspace(Blockly: any, workspace: any): {
  snapshot: unknown;
  runtimeWorkspace: any;
} {
  const snapshot = Blockly.serialization.workspaces.save(workspace);
  const runtimeWorkspace = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(snapshot, runtimeWorkspace);
  return {snapshot, runtimeWorkspace};
}

export {};
