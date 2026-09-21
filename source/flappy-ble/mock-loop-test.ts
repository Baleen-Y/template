type DeviceWorkspace = {
  blocks: {
    languageVersion: number;
    blocks: Array<any>;
  };
};

type UploadRequest = {
  artifact: {
    kind: 'micropython';
    source: string;
    workspacePolicy: 'replace';
    workspace: DeviceWorkspace;
  };
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sourceForRightMotor(speed: number): string {
  return [
    'def MQTT(mqtt_msg, voltage):',
    '  if mqtt_msg == "left":',
    `    moveup_right(${speed})`,
    ''
  ].join('\n');
}

async function runMockLoop(): Promise<void> {
  const initial: DeviceWorkspace = {
    blocks: {
      languageVersion: 0,
      blocks: [{
        type: 'flappy_device_program',
        inputs: {
          BODY: {
            block: {
              type: 'flappy_on_message',
              fields: {MESSAGE: 'left'},
              inputs: {
                DO: {
                  block: {
                    type: 'flappy_motor',
                    fields: {SIDE: 'RIGHT', DIR: 'FORWARD', SPEED: 50}
                  }
                }
              }
            }
          }
        }
      }]
    }
  };

  const uploads: UploadRequest[] = [];
  const upload = async (workspace: DeviceWorkspace, speed: number): Promise<void> => {
    uploads.push({
      artifact: {
        kind: 'micropython',
        source: sourceForRightMotor(speed),
        workspacePolicy: 'replace',
        workspace: clone(workspace)
      }
    });
  };

  const edited = clone(initial);
  edited.blocks.blocks[0].inputs.BODY.block.inputs.DO.block.fields.SPEED = 73;
  await upload(edited, 73);

  const wireJson = JSON.stringify(uploads[0].artifact.workspace);
  const fragments = [
    wireJson.slice(0, 1),
    wireJson.slice(1, 8),
    wireJson.slice(8, 31),
    wireJson.slice(31)
  ];
  const recovered = JSON.parse(fragments.join('')) as DeviceWorkspace;

  recovered.blocks.blocks[0].inputs.BODY.block.inputs.DO.block.fields.SPEED = 88;
  await upload(recovered, 88);

  if (!uploads[0].artifact.source.includes('moveup_right(73)')) throw new Error('first source mismatch');
  if (!uploads[1].artifact.source.includes('moveup_right(88)')) throw new Error('second source mismatch');
  if (uploads.some((item) => item.artifact.workspacePolicy !== 'replace')) throw new Error('workspacePolicy mismatch');
}

void runMockLoop();
