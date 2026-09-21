(() => {
  'use strict';

  if (!window.Blockly) throw new Error('Blockly runtime is missing.');
  const Blockly = window.Blockly;

  Blockly.defineBlocksWithJsonArray([
    {
      type: 'flappy_device_program',
      message0: 'Crowbot device program %1 %2',
      args0: [
        {type: 'input_dummy'},
        {type: 'input_statement', name: 'BODY'}
      ],
      colour: 210,
      tooltip: 'The single root block for the program uploaded to Crowbot.',
      helpUrl: ''
    },
    {
      type: 'flappy_on_message',
      message0: 'when game message %1 do %2 %3',
      args0: [
        {type: 'field_input', name: 'MESSAGE', text: 'moveup'},
        {type: 'input_dummy'},
        {type: 'input_statement', name: 'DO'}
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 210,
      tooltip: 'Runs device actions when the Flappy game sends this exact BLE text.',
      helpUrl: ''
    },
    {
      type: 'flappy_light',
      message0: 'device light %1',
      args0: [{
        type: 'field_dropdown',
        name: 'STATE',
        options: [['on', 'ON'], ['off', 'OFF'], ['random', 'RANDOM']]
      }],
      previousStatement: null,
      nextStatement: null,
      colour: 160,
      tooltip: 'Calls the configured Crowbot light function.',
      helpUrl: ''
    },
    {
      type: 'flappy_motor',
      message0: '%1 motor %2 speed %3',
      args0: [
        {type: 'field_dropdown', name: 'SIDE', options: [['left', 'LEFT'], ['right', 'RIGHT']]},
        {type: 'field_dropdown', name: 'DIR', options: [['forward', 'FORWARD'], ['backward', 'BACKWARD']]},
        {type: 'field_number', name: 'SPEED', value: 50, min: 0, max: 100, precision: 1}
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 160,
      tooltip: 'Moves one Crowbot motor using the configured command-library function.',
      helpUrl: ''
    },
    {
      type: 'flappy_motor_stop',
      message0: 'stop %1 motor',
      args0: [{
        type: 'field_dropdown',
        name: 'SIDE',
        options: [['left', 'LEFT'], ['right', 'RIGHT']]
      }],
      previousStatement: null,
      nextStatement: null,
      colour: 160,
      tooltip: 'Stops one Crowbot motor.',
      helpUrl: ''
    },
    {
      type: 'flappy_delay',
      message0: 'wait %1 ms',
      args0: [{
        type: 'field_number',
        name: 'MS',
        value: 300,
        min: 0,
        max: 10000,
        precision: 10
      }],
      previousStatement: null,
      nextStatement: null,
      colour: 120,
      tooltip: 'Adds time.sleep_ms(...) to the uploaded callback.',
      helpUrl: ''
    }
  ]);

  window.FlappyDeviceBlocks = Object.freeze({
    blockSetId: 'flappy-crowbot-device',
    blockSetVersion: '3.0.0',
    generatorVersion: '3.0.0',
    toolbox: Object.freeze({
      kind: 'categoryToolbox',
      contents: [
        {
          kind: 'category',
          name: 'Program',
          colour: '#4f8fd8',
          contents: [
            {kind: 'block', type: 'flappy_device_program'},
            {kind: 'block', type: 'flappy_on_message'}
          ]
        },
        {
          kind: 'category',
          name: 'Crowbot',
          colour: '#3da879',
          contents: [
            {kind: 'block', type: 'flappy_light'},
            {kind: 'block', type: 'flappy_motor'},
            {kind: 'block', type: 'flappy_motor_stop'}
          ]
        },
        {
          kind: 'category',
          name: 'Timing',
          colour: '#7d68cb',
          contents: [
            {kind: 'block', type: 'flappy_delay'}
          ]
        }
      ]
    })
  });
})();