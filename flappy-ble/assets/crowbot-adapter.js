(() => {
  'use strict';

  const ADAPTER = {
    id: 'crowbot-esp32-mqtt',
    version: '3.0.0',
    profileId: 'integem-crowbot-mqtt-v1',
    expectedFirmware: 'Inspected Crowbot ESP32 compatibility firmware',
    callbackName: 'MQTT',
    callbackArgs: ['mqtt_msg', 'voltage'],
    functions: Object.freeze({
      lightOn: 'light_turnon',
      lightOff: 'light_turnoff',
      lightRandom: 'light_random',
      leftForward: 'moveup_left',
      rightForward: 'moveup_right',
      leftBackward: 'movedown_left',
      rightBackward: 'movedown_right',
      leftStop: 'stopmove_left',
      rightStop: 'stopmove_right'
    })
  };

  const INDENT = '  ';

  function indent(level) {
    return INDENT.repeat(level);
  }

  function pyString(value) {
    // JSON string syntax is valid for the simple Python string literals used here.
    return JSON.stringify(String(value ?? ''));
  }

  function finiteNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function actionToPython(block, level, state) {
    const pad = indent(level);

    switch (block.type) {
      case 'flappy_on_message': {
        const message = String(block.getFieldValue('MESSAGE') || '');
        const child = block.getInputTargetBlock('DO');
        let body = child ? chainToPython(child, level + 1, state) : '';
        if (!body) body = indent(level + 1) + 'pass\n';
        return pad + 'if mqtt_msg == ' + pyString(message) + ':\n' + body;
      }

      case 'flappy_light': {
        const mode = block.getFieldValue('STATE');
        const fn = mode === 'OFF'
          ? ADAPTER.functions.lightOff
          : mode === 'RANDOM'
            ? ADAPTER.functions.lightRandom
            : ADAPTER.functions.lightOn;
        return pad + fn + '()\n';
      }

      case 'flappy_motor': {
        const side = block.getFieldValue('SIDE');
        const dir = block.getFieldValue('DIR');
        const speed = Math.round(finiteNumber(block.getFieldValue('SPEED'), 0, 100, 50));
        let fn;
        if (side === 'RIGHT' && dir === 'BACKWARD') fn = ADAPTER.functions.rightBackward;
        else if (side === 'RIGHT') fn = ADAPTER.functions.rightForward;
        else if (dir === 'BACKWARD') fn = ADAPTER.functions.leftBackward;
        else fn = ADAPTER.functions.leftForward;
        return pad + fn + '(' + speed + ')\n';
      }

      case 'flappy_motor_stop': {
        const fn = block.getFieldValue('SIDE') === 'RIGHT'
          ? ADAPTER.functions.rightStop
          : ADAPTER.functions.leftStop;
        return pad + fn + '(0)\n';
      }

      case 'flappy_delay': {
        state.usesTime = true;
        const ms = Math.round(finiteNumber(block.getFieldValue('MS'), 0, 10000, 300));
        return pad + 'time.sleep_ms(' + ms + ')\n';
      }

      default:
        throw new Error('Unsupported device block: ' + block.type);
    }
  }

  function chainToPython(first, level, state) {
    let code = '';
    let current = first;
    let steps = 0;

    while (current) {
      steps += 1;
      if (steps > 200) throw new Error('Device program is too long.');
      code += actionToPython(current, level, state);
      current = current.getNextBlock();
    }
    return code;
  }

  function inspectWorkspace(workspace) {
    const roots = workspace.getTopBlocks(false);
    if (roots.length !== 1 || roots[0].type !== 'flappy_device_program') {
      throw new Error('Use exactly one "Crowbot device program" root block.');
    }

    const all = workspace.getAllBlocks(false);
    for (const block of all) {
      const allowed = new Set([
        'flappy_device_program',
        'flappy_on_message',
        'flappy_light',
        'flappy_motor',
        'flappy_motor_stop',
        'flappy_delay'
      ]);
      if (!allowed.has(block.type)) {
        throw new Error('Unsupported block in device workspace: ' + block.type);
      }
    }

    const orphanActions = roots.filter((b) => b.type !== 'flappy_device_program');
    if (orphanActions.length) {
      throw new Error('All device actions must be connected inside the device program block.');
    }

    return roots[0];
  }

  function generateFromWorkspace(workspace) {
    const root = inspectWorkspace(workspace);
    const state = {usesTime: false};
    const first = root.getInputTargetBlock('BODY');
    let body = first ? chainToPython(first, 1, state) : '';
    if (!body) body = INDENT + 'pass\n';

    let source = '';
    if (state.usesTime) source += 'import time\n\n';
    source += 'def MQTT(mqtt_msg, voltage):\n' + body;

    // The compatibility host rejects these because the inspected firmware transport cannot represent them safely.
    if (source.includes('/n')) {
      throw new Error('Generated source contains the literal characters "/n", which this Crowbot transport rejects.');
    }
    if (source.endsWith('/')) {
      throw new Error('Generated source cannot end with a slash for this Crowbot transport.');
    }

    const bytes = new TextEncoder().encode(source).length;
    if (bytes > 128 * 1024) {
      throw new Error('Generated Crowbot source exceeds 128 KiB.');
    }

    return source;
  }

  function generateFromSnapshot(snapshot, Blockly) {
    const temp = new Blockly.Workspace();
    try {
      Blockly.serialization.workspaces.load(snapshot, temp);
      return generateFromWorkspace(temp);
    } finally {
      temp.dispose();
    }
  }

  window.FlappyCrowbotAdapter = Object.freeze({
    ...ADAPTER,
    generateFromWorkspace,
    generateFromSnapshot,
    inspectWorkspace
  });
})();