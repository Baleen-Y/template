(() => {
  'use strict';

  if (!window.Blockly) {
    throw new Error('Blockly runtime is missing.');
  }

  const Blockly = window.Blockly;

  Blockly.defineBlocksWithJsonArray([
    {
      "type": "flappy_event_start",
      "message0": "when game starts %1 %2",
      "args0": [
        {"type": "input_dummy"},
        {"type": "input_statement", "name": "DO"}
      ],
      "colour": 35,
      "tooltip": "Runs once after a new round starts.",
      "helpUrl": ""
    },
    {
      "type": "flappy_event_up",
      "message0": "when UP is pressed %1 %2",
      "args0": [
        {"type": "input_dummy"},
        {"type": "input_statement", "name": "DO"}
      ],
      "colour": 35,
      "tooltip": "Runs when the UP button or keyboard ArrowUp is pressed.",
      "helpUrl": ""
    },
    {
      "type": "flappy_event_down",
      "message0": "when DOWN is pressed %1 %2",
      "args0": [
        {"type": "input_dummy"},
        {"type": "input_statement", "name": "DO"}
      ],
      "colour": 35,
      "tooltip": "Runs when the DOWN button or keyboard ArrowDown is pressed.",
      "helpUrl": ""
    },
    {
      "type": "flappy_event_pipe",
      "message0": "when a pipe is passed %1 %2",
      "args0": [
        {"type": "input_dummy"},
        {"type": "input_statement", "name": "DO"}
      ],
      "colour": 35,
      "tooltip": "Runs once whenever the bird passes a pipe.",
      "helpUrl": ""
    },
    {
      "type": "flappy_event_gameover",
      "message0": "when game is over %1 %2",
      "args0": [
        {"type": "input_dummy"},
        {"type": "input_statement", "name": "DO"}
      ],
      "colour": 35,
      "tooltip": "Runs once when the round ends.",
      "helpUrl": ""
    },

    {
      "type": "flappy_flap",
      "message0": "bird flap power %1",
      "args0": [{"type": "field_number", "name": "POWER", "value": 430, "min": 0, "max": 1000, "precision": 10}],
      "previousStatement": null,
      "nextStatement": null,
      "colour": 155,
      "tooltip": "Applies an upward velocity to the bird.",
      "helpUrl": ""
    },
    {
      "type": "flappy_dive",
      "message0": "bird dive power %1",
      "args0": [{"type": "field_number", "name": "POWER", "value": 360, "min": 0, "max": 1000, "precision": 10}],
      "previousStatement": null,
      "nextStatement": null,
      "colour": 155,
      "tooltip": "Adds downward velocity to the bird.",
      "helpUrl": ""
    },
    {
      "type": "flappy_send_ble",
      "message0": "send BLE command %1",
      "args0": [{"type": "field_input", "name": "TEXT", "text": "left"}],
      "previousStatement": null,
      "nextStatement": null,
      "colour": 210,
      "tooltip": "Sends this exact UTF-8 text through iCreator BLE.",
      "helpUrl": ""
    },
    {
      "type": "flappy_set_gravity",
      "message0": "set gravity %1",
      "args0": [{"type": "field_number", "name": "VALUE", "value": 1250, "min": 100, "max": 4000, "precision": 50}],
      "previousStatement": null,
      "nextStatement": null,
      "colour": 260,
      "tooltip": "Changes gravity for this round.",
      "helpUrl": ""
    },
    {
      "type": "flappy_set_gap",
      "message0": "set pipe gap %1 px",
      "args0": [{"type": "field_number", "name": "VALUE", "value": 150, "min": 90, "max": 300, "precision": 5}],
      "previousStatement": null,
      "nextStatement": null,
      "colour": 260,
      "tooltip": "Changes the opening between pipe pairs.",
      "helpUrl": ""
    },
    {
      "type": "flappy_set_speed",
      "message0": "set pipe speed %1",
      "args0": [{"type": "field_number", "name": "VALUE", "value": 235, "min": 80, "max": 600, "precision": 5}],
      "previousStatement": null,
      "nextStatement": null,
      "colour": 260,
      "tooltip": "Changes how fast pipes move.",
      "helpUrl": ""
    },
    {
      "type": "flappy_add_score",
      "message0": "add score %1",
      "args0": [{"type": "field_number", "name": "VALUE", "value": 1, "min": -100, "max": 100, "precision": 1}],
      "previousStatement": null,
      "nextStatement": null,
      "colour": 65,
      "tooltip": "Adds or subtracts score.",
      "helpUrl": ""
    },
    {
      "type": "flappy_wait",
      "message0": "wait %1 seconds",
      "args0": [{"type": "field_number", "name": "SECONDS", "value": 0.2, "min": 0, "max": 10, "precision": 0.1}],
      "previousStatement": null,
      "nextStatement": null,
      "colour": 120,
      "tooltip": "Waits before the next action in this event chain.",
      "helpUrl": ""
    },
    {
      "type": "flappy_if_score",
      "message0": "if score %1 %2 %3 %4",
      "args0": [
        {
          "type": "field_dropdown",
          "name": "OP",
          "options": [[">=", "GTE"], [">", "GT"], ["=", "EQ"], ["<", "LT"], ["<=", "LTE"]]
        },
        {"type": "field_number", "name": "VALUE", "value": 5, "precision": 1},
        {"type": "input_dummy"},
        {"type": "input_statement", "name": "DO"}
      ],
      "previousStatement": null,
      "nextStatement": null,
      "colour": 290,
      "tooltip": "Runs nested actions when the score comparison is true.",
      "helpUrl": ""
    },
    {
      "type": "flappy_repeat",
      "message0": "repeat %1 times %2 %3",
      "args0": [
        {"type": "field_number", "name": "COUNT", "value": 2, "min": 1, "max": 20, "precision": 1},
        {"type": "input_dummy"},
        {"type": "input_statement", "name": "DO"}
      ],
      "previousStatement": null,
      "nextStatement": null,
      "colour": 120,
      "tooltip": "Repeats nested actions. The limit keeps game programs bounded.",
      "helpUrl": ""
    }
  ]);

  window.FlappyBlockly = Object.freeze({
    blockSetId: 'flappy-ble-blocks',
    blockSetVersion: '2.0.0',
    generatorVersion: '2.0.0',
    eventTypes: Object.freeze({
      start: 'flappy_event_start',
      up: 'flappy_event_up',
      down: 'flappy_event_down',
      pipe: 'flappy_event_pipe',
      gameover: 'flappy_event_gameover'
    }),
    toolbox: Object.freeze({
      kind: 'categoryToolbox',
      contents: [
        {
          kind: 'category',
          name: 'Events',
          colour: '#d98b36',
          contents: [
            {kind:'block', type:'flappy_event_start'},
            {kind:'block', type:'flappy_event_up'},
            {kind:'block', type:'flappy_event_down'},
            {kind:'block', type:'flappy_event_pipe'},
            {kind:'block', type:'flappy_event_gameover'}
          ]
        },
        {
          kind: 'category',
          name: 'Bird & BLE',
          colour: '#3aa678',
          contents: [
            {kind:'block', type:'flappy_flap'},
            {kind:'block', type:'flappy_dive'},
            {kind:'block', type:'flappy_send_ble'}
          ]
        },
        {
          kind: 'category',
          name: 'Game',
          colour: '#6c69d9',
          contents: [
            {kind:'block', type:'flappy_set_gravity'},
            {kind:'block', type:'flappy_set_gap'},
            {kind:'block', type:'flappy_set_speed'},
            {kind:'block', type:'flappy_add_score'}
          ]
        },
        {
          kind: 'category',
          name: 'Logic',
          colour: '#8d64d4',
          contents: [
            {kind:'block', type:'flappy_if_score'},
            {kind:'block', type:'flappy_repeat'},
            {kind:'block', type:'flappy_wait'}
          ]
        }
      ]
    })
  });
})();