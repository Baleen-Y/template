declare global {
  interface Window {
    icreator?: ICreatorSdk;
    Blockly: any;
  }
}

type Target = { deviceId: string; connectionId: string };

type Device = Target & {
  name: string;
  profileId: string;
};

type DeviceState = {
  projectSessionId: string;
  currentDevice: Device | null;
  activity: null | {
    kind: 'send' | 'read' | 'upload';
    owner: {type: 'host' | 'module'; id: string};
    jobId?: string;
  };
};

interface ICreatorSdk {
  ready(): Promise<{
    apiVersion: string;
    module: {id: string; version: string};
    project: {sessionId: string};
  }>;
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
  };
  device: {
    connect(options: {profileId: string}): Promise<DeviceState>;
    disconnect(target: Target): Promise<void>;
    getState(): Promise<DeviceState>;
    watchState(callback: (state: DeviceState) => void): Promise<() => void>;
    onData(callback: (event: {
      deviceId: string;
      connectionId: string;
      projectSessionId: string;
      data: number[];
    }) => void): Promise<() => void>;
    send(request: Target & {text: string}): Promise<void>;
    upload(request: Target & {
      profileId: string;
      clientRequestId: string;
      artifact: {
        kind: 'micropython';
        source: string;
        workspacePolicy: 'replace';
        workspace: unknown;
      };
    }): Promise<{jobId: string}>;
    watchUpload(jobId: string, callback: (state: unknown) => void): Promise<() => void>;
    waitForUpload(jobId: string): Promise<{confirmation?: string}>;
    cancelUpload(jobId: string): Promise<void>;
  };
  lifecycle: {
    onVisibilityChange(callback: (visible: boolean) => void): () => void;
    onDispose(callback: () => void): void;
  };
}

/**
 * v3 architecture:
 *
 * browser Flappy game
 *   -> sdk.device.send("moveup" | "left" | "right" | "stop")
 *
 * independent device Blockly workspace
 *   -> frozen Blockly JSON
 *   -> module-owned Crowbot Python generator
 *   -> sdk.device.upload(source + workspacePolicy:"replace" + same snapshot)
 *
 * device workspace readback
 *   -> subscribe sdk.device.onData first
 *   -> sdk.device.send("get_device_block_xml")
 *   -> bounded streaming UTF-8 / JSON parser
 *   -> validate in temporary Blockly workspace
 *   -> user-approved editor replacement
 *
 * The browser does not execute the uploaded device Python.
 */

export async function uploadCrowbotProgram(
  sdk: ICreatorSdk,
  target: Device,
  snapshot: unknown,
  source: string
): Promise<string> {
  if (target.profileId !== 'integem-crowbot-mqtt-v1') {
    throw new Error('Compatible Crowbot profile required');
  }

  const {jobId} = await sdk.device.upload({
    deviceId: target.deviceId,
    connectionId: target.connectionId,
    profileId: target.profileId,
    clientRequestId: crypto.randomUUID(),
    artifact: {
      kind: 'micropython',
      source,
      workspacePolicy: 'replace',
      workspace: snapshot
    }
  });

  await sdk.device.waitForUpload(jobId);
  return jobId;
}

export {};
