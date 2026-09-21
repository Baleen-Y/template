(() => {
  'use strict';

  const MODULE_VERSION = '2.0.0';
  const WORKSPACE_KEY = 'workspace.v2';
  const META_KEY = 'workspace.meta.v2';
  const BEST_KEY = 'bestScore';
  const SAVE_DEBOUNCE_MS = 500;
  const MAX_WORKSPACE_BYTES = 220 * 1024;
  const BLE_MIN_INTERVAL_MS = 120;

  const $ = (id) => document.getElementById(id);
  const canvas = $('gameCanvas');
  const ctx = canvas.getContext('2d');

  const ui = {
    sdkWarning: $('sdkWarning'),
    deviceStatus: $('deviceStatus'),
    connectBtn: $('connectBtn'),
    disconnectBtn: $('disconnectBtn'),
    startBtn: $('startBtn'),
    stopBtn: $('stopBtn'),
    overlayStartBtn: $('overlayStartBtn'),
    overlay: $('overlay'),
    overlayTitle: $('overlayTitle'),
    overlayText: $('overlayText'),
    upBtn: $('upBtn'),
    downBtn: $('downBtn'),
    score: $('score'),
    best: $('best'),
    gravityValue: $('gravityValue'),
    gapValue: $('gapValue'),
    speedValue: $('speedValue'),
    runtimeState: $('runtimeState'),
    commandLog: $('commandLog'),
    clearLogBtn: $('clearLogBtn'),
    saveWorkspaceBtn: $('saveWorkspaceBtn'),
    resetWorkspaceBtn: $('resetWorkspaceBtn'),
    workspaceStatus: $('workspaceStatus'),
    blocklyVersion: $('blocklyVersion'),
    blocklyDiv: $('blocklyDiv')
  };

  const game = {
    mode: 'ready',
    score: 0,
    best: 0,
    gravity: 1250,
    pipeGap: 150,
    pipeSpeed: 235,
    spawnEvery: 1.45,
    lastFrame: 0,
    spawnTimer: 0,
    bird: { x: 180, y: 250, vy: 0, r: 18 },
    pipes: [],
    particles: [],
    runtimeWorkspace: null,
    runtimeSnapshot: null,
    eventRunToken: 0,
    eventPromises: new Set()
  };

  let sdk = null;
  let sdkContext = null;
  let latestState = null;
  let visible = true;
  let disposed = false;
  let workspace = null;
  let saveTimer = null;
  let offState = null;
  let offVisibility = null;
  let bleLastSendAt = 0;
  let bleQueue = Promise.resolve();
  let resizeObserver = null;

  function log(message, type = 'muted') {
    const row = document.createElement('div');
    row.className = type;
    row.textContent = '[' + new Date().toLocaleTimeString() + '] ' + message;
    ui.commandLog.appendChild(row);
    while (ui.commandLog.childElementCount > 160) {
      ui.commandLog.removeChild(ui.commandLog.firstChild);
    }
    ui.commandLog.scrollTop = ui.commandLog.scrollHeight;
  }

  function logError(operation, error) {
    const message = error && error.message ? error.message : String(error || 'Unknown error');
    console.error('[Flappy BLE ' + MODULE_VERSION + '] ' + operation + ' failed:', error);
    log(operation + ' failed: ' + message, 'err');
  }

  function setWorkspaceStatus(message, type = '') {
    ui.workspaceStatus.textContent = message;
    ui.workspaceStatus.className = type;
  }

  function setRuntimeState(message, active = false) {
    ui.runtimeState.textContent = message;
    ui.runtimeState.className = 'pill' + (active ? ' active' : '');
  }

  function updatePhysicsUi() {
    ui.gravityValue.textContent = String(Math.round(game.gravity));
    ui.gapValue.textContent = String(Math.round(game.pipeGap));
    ui.speedValue.textContent = String(Math.round(game.pipeSpeed));
  }

  function updateScoreUi() {
    ui.score.textContent = String(game.score);
    ui.best.textContent = String(game.best);
  }

  function niceSdkError(error, operation) {
    const code = error && error.code ? String(error.code) : '';
    const raw = error && error.message ? String(error.message) : String(error || 'Unknown error');
    const hints = {
      USER_CANCELED: 'Device selection was canceled.',
      NOT_CONNECTED: 'No Bluetooth device is connected.',
      STALE_CONNECTION: 'The shared Bluetooth connection changed. Try the action again.',
      BUSY: 'The shared device is busy with another operation.',
      PAYLOAD_TOO_LARGE: 'The BLE command is too large for this connection.',
      PROJECT_CHANGED: 'The iCreator project session changed.',
      PERMISSION_DENIED: 'Permission was denied for this operation.',
      UNSUPPORTED: 'This operation is not supported in the current host.'
    };
    return operation + ': ' + (hints[code] || raw);
  }

  function starterWorkspaceJson() {
    return {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'flappy_event_start', id: 'evt_start', x: 30, y: 30,
            inputs: {
              DO: {
                block: {
                  type: 'flappy_send_ble', id: 'send_start',
                  fields: {TEXT: 'moveup'},
                  next: {
                    block: {
                      type: 'flappy_set_gravity', id: 'set_gravity',
                      fields: {VALUE: 1250},
                      next: {
                        block: {
                          type: 'flappy_set_gap', id: 'set_gap',
                          fields: {VALUE: 150}
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          {
            type: 'flappy_event_up', id: 'evt_up', x: 30, y: 210,
            inputs: {
              DO: {
                block: {
                  type: 'flappy_flap', id: 'flap_default',
                  fields: {POWER: 430},
                  next: {
                    block: {
                      type: 'flappy_send_ble', id: 'send_left',
                      fields: {TEXT: 'left'}
                    }
                  }
                }
              }
            }
          },
          {
            type: 'flappy_event_down', id: 'evt_down', x: 330, y: 210,
            inputs: {
              DO: {
                block: {
                  type: 'flappy_dive', id: 'dive_default',
                  fields: {POWER: 360},
                  next: {
                    block: {
                      type: 'flappy_send_ble', id: 'send_right',
                      fields: {TEXT: 'right'}
                    }
                  }
                }
              }
            }
          },
          {
            type: 'flappy_event_pipe', id: 'evt_pipe', x: 330, y: 30
          },
          {
            type: 'flappy_event_gameover', id: 'evt_over', x: 610, y: 30,
            inputs: {
              DO: {
                block: {
                  type: 'flappy_send_ble', id: 'send_stop',
                  fields: {TEXT: 'stop'}
                }
              }
            }
          }
        ]
      }
    };
  }

  function requireBlockly() {
    if (!window.Blockly || !window.FlappyBlockly) {
      throw new Error('Bundled Blockly runtime or Flappy block definitions are missing.');
    }
    if (!window.Blockly.serialization || !window.Blockly.serialization.workspaces) {
      throw new Error('This bundled Blockly build does not provide workspace JSON serialization.');
    }
  }

  async function initBlockly() {
    requireBlockly();
    const Blockly = window.Blockly;

    ui.blocklyVersion.textContent = 'Blockly ' + (Blockly.VERSION || 'bundled');

    workspace = Blockly.inject(ui.blocklyDiv, {
      toolbox: window.FlappyBlockly.toolbox,
      trashcan: true,
      renderer: 'zelos',
      move: {scrollbars: true, drag: true, wheel: true},
      zoom: {controls: true, wheel: true, startScale: 0.88, maxScale: 1.4, minScale: 0.45, scaleSpeed: 1.08},
      grid: {spacing: 24, length: 3, colour: '#29465c', snap: true}
    });

    workspace.addChangeListener((event) => {
      if (disposed || !event || event.isUiEvent) return;
      scheduleWorkspaceSave();
    });

    resizeObserver = new ResizeObserver(() => {
      if (workspace) Blockly.svgResize(workspace);
    });
    resizeObserver.observe(ui.blocklyDiv);

    await restoreWorkspace();
  }

  async function restoreWorkspace() {
    const Blockly = window.Blockly;
    let restored = false;

    if (sdk) {
      try {
        const saved = await sdk.storage.get(WORKSPACE_KEY);
        if (saved && typeof saved === 'object') {
          const temp = new Blockly.Workspace();
          try {
            Blockly.serialization.workspaces.load(saved, temp);
            temp.dispose();
            Blockly.serialization.workspaces.load(saved, workspace);
            restored = true;
            setWorkspaceStatus('Saved blocks restored.', 'ok');
          } catch (error) {
            temp.dispose();
            logError('Workspace restore validation', error);
            setWorkspaceStatus('Saved blocks were incompatible; starter blocks loaded.', 'err');
          }
        }
      } catch (error) {
        logError('Workspace storage read', error);
      }
    }

    if (!restored) {
      Blockly.serialization.workspaces.load(starterWorkspaceJson(), workspace);
      setWorkspaceStatus('Starter blocks loaded.');
    }

    Blockly.svgResize(workspace);
  }

  function scheduleWorkspaceSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveWorkspace('Autosaved'), SAVE_DEBOUNCE_MS);
  }

  async function saveWorkspace(label = 'Saved') {
    if (!sdk || !workspace) return false;
    try {
      const snapshot = window.Blockly.serialization.workspaces.save(workspace);
      const serialized = JSON.stringify(snapshot);
      const bytes = new TextEncoder().encode(serialized).length;
      if (bytes > MAX_WORKSPACE_BYTES) {
        setWorkspaceStatus('Workspace is too large to save safely (' + Math.ceil(bytes / 1024) + ' KiB).', 'err');
        return false;
      }

      const metadata = {
        workspaceSchemaVersion: 2,
        blockSetId: window.FlappyBlockly.blockSetId,
        blockSetVersion: window.FlappyBlockly.blockSetVersion,
        generatorVersion: window.FlappyBlockly.generatorVersion,
        adapterId: 'flappy-browser-runtime',
        adapterVersion: MODULE_VERSION,
        expectedFirmwareVersion: null,
        timestamp: new Date().toISOString(),
        provenance: 'local-editor'
      };

      await sdk.storage.set(WORKSPACE_KEY, snapshot);
      await sdk.storage.set(META_KEY, metadata);
      setWorkspaceStatus(label + ' · ' + Math.ceil(bytes / 1024) + ' KiB', 'ok');
      return true;
    } catch (error) {
      logError('Workspace save', error);
      setWorkspaceStatus('Save failed.', 'err');
      return false;
    }
  }

  async function resetWorkspace() {
    if (!workspace) return;
    const accepted = window.confirm('Replace the current blocks with the starter Flappy program?');
    if (!accepted) return;

    try {
      window.Blockly.serialization.workspaces.load(starterWorkspaceJson(), workspace);
      await saveWorkspace('Starter blocks saved');
      log('Starter Blockly program restored.', 'ok');
    } catch (error) {
      logError('Starter workspace restore', error);
    }
  }

  function updateDeviceUi(state) {
    latestState = state;
    const device = state && state.currentDevice;
    const busy = !!(state && state.activity);

    if (device) {
      ui.deviceStatus.textContent = device.name + (busy ? ' · Busy' : ' · Connected');
      ui.deviceStatus.className = 'status ' + (busy ? 'busy' : 'connected');
      ui.connectBtn.disabled = true;
      ui.disconnectBtn.disabled = false;
      ui.startBtn.disabled = busy || !workspace;
      ui.overlayStartBtn.disabled = busy || !workspace;
    } else {
      ui.deviceStatus.textContent = 'Disconnected';
      ui.deviceStatus.className = 'status disconnected';
      ui.connectBtn.disabled = !sdk;
      ui.disconnectBtn.disabled = true;
      ui.startBtn.disabled = true;
      ui.overlayStartBtn.disabled = true;
    }
  }

  async function connectDevice() {
    if (!sdk || !visible) return;
    ui.connectBtn.disabled = true;
    try {
      log('Opening the iCreator Bluetooth chooser…');
      const state = await sdk.device.connect({profileId: 'integem-crowbot-mqtt-v1'});
      updateDeviceUi(state);
      if (state.currentDevice) {
        log('Connected: ' + state.currentDevice.name, 'ok');
      }
    } catch (error) {
      log(niceSdkError(error, 'Connect'), 'err');
      console.error('[Flappy BLE ' + MODULE_VERSION + '] connect failed:', error);
      try {
        updateDeviceUi(await sdk.device.getState());
      } catch (_) {}
    }
  }

  async function disconnectDevice() {
    if (!sdk || !visible) return;
    try {
      const state = await sdk.device.getState();
      if (!state.currentDevice) return;
      await sdk.device.disconnect({
        deviceId: state.currentDevice.deviceId,
        connectionId: state.currentDevice.connectionId
      });
      log('Bluetooth disconnected.', 'ok');
    } catch (error) {
      log(niceSdkError(error, 'Disconnect'), 'err');
      console.error('[Flappy BLE ' + MODULE_VERSION + '] disconnect failed:', error);
    }
  }

  function enqueueBleCommand(text, blockId) {
    const command = String(text || '').trim();
    if (!command) {
      log('BLE block skipped: command is empty.', 'err');
      return Promise.resolve(false);
    }

    const task = async () => {
      if (!sdk || !visible || disposed) return false;

      const waitMs = Math.max(0, BLE_MIN_INTERVAL_MS - (performance.now() - bleLastSendAt));
      if (waitMs > 0) await sleep(waitMs);

      try {
        const state = await sdk.device.getState();
        latestState = state;
        const target = state.currentDevice;
        if (!target) {
          log('BLE "' + command + '" not sent: no connected device.', 'err');
          return false;
        }
        if (state.activity) {
          log('BLE "' + command + '" not sent: device is busy. It will not be replayed.', 'err');
          return false;
        }

        bleLastSendAt = performance.now();
        await sdk.device.send({
          deviceId: target.deviceId,
          connectionId: target.connectionId,
          text: command
        });
        log('BLE → ' + command, 'ok');
        flashBlock(blockId);
        return true;
      } catch (error) {
        log(niceSdkError(error, 'Send "' + command + '"'), 'err');
        console.error('[Flappy BLE ' + MODULE_VERSION + '] send failed:', error);
        return false;
      }
    };

    const result = bleQueue.then(task, task);
    bleQueue = result.catch(() => false);
    return result;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function flashBlock(blockId) {
    if (!workspace || !blockId || disposed) return;
    try {
      workspace.highlightBlock(blockId);
      setTimeout(() => {
        if (workspace && !disposed) workspace.highlightBlock(null);
      }, 180);
    } catch (_) {}
  }

  function resetRoundState() {
    game.score = 0;
    game.gravity = 1250;
    game.pipeGap = 150;
    game.pipeSpeed = 235;
    game.spawnEvery = 1.45;
    game.spawnTimer = 0;
    game.bird.x = 180;
    game.bird.y = canvas.height * 0.48;
    game.bird.vy = 0;
    game.pipes = [];
    game.particles = [];
    game.eventRunToken += 1;
    game.eventPromises.clear();
    updateScoreUi();
    updatePhysicsUi();
  }

  function freezeRuntimeWorkspace() {
    if (!workspace) throw new Error('Blockly workspace is not ready.');

    const snapshot = window.Blockly.serialization.workspaces.save(workspace);
    const temp = new window.Blockly.Workspace();

    try {
      window.Blockly.serialization.workspaces.load(snapshot, temp);
    } catch (error) {
      temp.dispose();
      throw new Error('Current blocks could not be frozen for this round: ' + error.message);
    }

    if (game.runtimeWorkspace) game.runtimeWorkspace.dispose();
    game.runtimeWorkspace = temp;
    game.runtimeSnapshot = snapshot;
    return snapshot;
  }

  function findEventBlocks(eventName) {
    if (!game.runtimeWorkspace) return [];
    const expectedType = window.FlappyBlockly.eventTypes[eventName];
    return game.runtimeWorkspace.getTopBlocks(true).filter((block) => block.type === expectedType);
  }

  function executeEvent(eventName) {
    if (game.mode === 'ready' || disposed || !visible) return Promise.resolve();
    const token = game.eventRunToken;
    const roots = findEventBlocks(eventName);

    if (!roots.length) {
      log('Event ' + eventName + ': no Blockly handler.');
      return Promise.resolve();
    }

    log('Event: ' + eventName, 'event');
    const promise = Promise.all(
      roots.map((root) => executeChain(root.getInputTargetBlock('DO'), token, 0))
    ).catch((error) => {
      logError('Blockly event ' + eventName, error);
    }).finally(() => {
      game.eventPromises.delete(promise);
    });

    game.eventPromises.add(promise);
    return promise;
  }

  async function executeChain(block, token, depth) {
    if (!block || token !== game.eventRunToken || disposed || !visible) return;
    if (depth > 80) throw new Error('Blockly execution stopped: chain is too deep.');

    let current = block;
    let steps = 0;

    while (current && token === game.eventRunToken && !disposed && visible) {
      steps += 1;
      if (steps > 120) throw new Error('Blockly execution stopped: too many actions in one event.');

      flashBlock(current.id);

      switch (current.type) {
        case 'flappy_flap': {
          const power = clampNumber(current.getFieldValue('POWER'), 0, 1000, 430);
          game.bird.vy = -power;
          break;
        }
        case 'flappy_dive': {
          const power = clampNumber(current.getFieldValue('POWER'), 0, 1000, 360);
          game.bird.vy = Math.max(game.bird.vy + power, power * 0.8);
          break;
        }
        case 'flappy_send_ble': {
          await enqueueBleCommand(current.getFieldValue('TEXT'), current.id);
          break;
        }
        case 'flappy_set_gravity': {
          game.gravity = clampNumber(current.getFieldValue('VALUE'), 100, 4000, 1250);
          updatePhysicsUi();
          break;
        }
        case 'flappy_set_gap': {
          game.pipeGap = clampNumber(current.getFieldValue('VALUE'), 90, 300, 150);
          updatePhysicsUi();
          break;
        }
        case 'flappy_set_speed': {
          game.pipeSpeed = clampNumber(current.getFieldValue('VALUE'), 80, 600, 235);
          updatePhysicsUi();
          break;
        }
        case 'flappy_add_score': {
          const delta = clampNumber(current.getFieldValue('VALUE'), -100, 100, 0);
          game.score = Math.max(0, Math.round(game.score + delta));
          updateScoreUi();
          break;
        }
        case 'flappy_wait': {
          const seconds = clampNumber(current.getFieldValue('SECONDS'), 0, 10, 0);
          await sleep(seconds * 1000);
          break;
        }
        case 'flappy_if_score': {
          const target = Number(current.getFieldValue('VALUE'));
          const op = current.getFieldValue('OP');
          let pass = false;
          if (op === 'GTE') pass = game.score >= target;
          else if (op === 'GT') pass = game.score > target;
          else if (op === 'EQ') pass = game.score === target;
          else if (op === 'LT') pass = game.score < target;
          else if (op === 'LTE') pass = game.score <= target;
          if (pass) {
            await executeChain(current.getInputTargetBlock('DO'), token, depth + 1);
          }
          break;
        }
        case 'flappy_repeat': {
          const count = Math.round(clampNumber(current.getFieldValue('COUNT'), 1, 20, 1));
          for (let i = 0; i < count; i += 1) {
            if (token !== game.eventRunToken || disposed || !visible) break;
            await executeChain(current.getInputTargetBlock('DO'), token, depth + 1);
          }
          break;
        }
        default:
          throw new Error('Unsupported Blockly action: ' + current.type);
      }

      current = current.getNextBlock();
    }
  }

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  async function startGame() {
    if (game.mode === 'running') return;
    if (!sdk || !workspace) return;

    try {
      const state = await sdk.device.getState();
      if (!state.currentDevice) {
        log('Connect Bluetooth before starting the game.', 'err');
        return;
      }
      if (state.activity) {
        log('The shared device is busy. Start was not run.', 'err');
        return;
      }

      freezeRuntimeWorkspace();
      await saveWorkspace('Saved before run');
      resetRoundState();
      game.mode = 'running';
      game.lastFrame = performance.now();
      setRuntimeState('Running frozen blocks', true);
      ui.overlay.classList.add('hidden');
      ui.stopBtn.disabled = false;
      ui.startBtn.disabled = true;
      ui.overlayStartBtn.disabled = true;

      await executeEvent('start');
    } catch (error) {
      logError('Start round', error);
      setRuntimeState('Start failed');
    }
  }

  async function stopGame(reason = 'Stopped') {
    if (game.mode !== 'running') return;
    game.mode = 'over';
    game.eventRunToken += 1;
    setRuntimeState(reason);
    ui.stopBtn.disabled = true;

    try {
      const state = sdk ? await sdk.device.getState() : null;
      updateDeviceUi(state || latestState || {currentDevice:null, activity:null});
    } catch (_) {}

    ui.overlayTitle.textContent = reason;
    ui.overlayText.textContent = 'Score: ' + game.score + ' · Best: ' + game.best;
    ui.overlayStartBtn.textContent = 'Run Again';
    ui.overlay.classList.remove('hidden');

    await runGameOverEventIsolated();
  }

  async function runGameOverEventIsolated() {
    const oldMode = game.mode;
    const token = game.eventRunToken;
    game.mode = 'over-active-event';
    try {
      const roots = findEventBlocks('gameover');
      if (roots.length) {
        log('Event: gameover', 'event');
        await Promise.all(roots.map((root) => executeChain(root.getInputTargetBlock('DO'), token, 0)));
      }
    } catch (error) {
      logError('Blockly gameover event', error);
    } finally {
      game.mode = oldMode;
    }
  }

  async function collisionGameOver() {
    if (game.mode !== 'running') return;
    addBurst(game.bird.x, game.bird.y);

    if (game.score > game.best) {
      game.best = game.score;
      updateScoreUi();
      if (sdk) {
        try {
          await sdk.storage.set(BEST_KEY, game.best);
        } catch (error) {
          logError('Best score save', error);
        }
      }
    }

    await stopGame('Game Over');
  }

  function spawnPipe() {
    const gap = game.pipeGap;
    const margin = 72;
    const minCenter = margin + gap / 2;
    const maxCenter = canvas.height - 26 - margin - gap / 2;
    const center = minCenter + Math.random() * Math.max(1, maxCenter - minCenter);

    game.pipes.push({
      x: canvas.width + 40,
      width: 70,
      top: center - gap / 2,
      bottom: center + gap / 2,
      scored: false
    });
  }

  function update(dt) {
    if (game.mode !== 'running') return;

    const bird = game.bird;
    bird.vy += game.gravity * dt;
    bird.y += bird.vy * dt;

    game.spawnTimer += dt;
    if (game.spawnTimer >= game.spawnEvery) {
      game.spawnTimer -= game.spawnEvery;
      spawnPipe();
    }

    for (const pipe of game.pipes) {
      pipe.x -= game.pipeSpeed * dt;
      if (!pipe.scored && pipe.x + pipe.width < bird.x) {
        pipe.scored = true;
        game.score += 1;
        updateScoreUi();
        void executeEvent('pipe');
      }
    }

    game.pipes = game.pipes.filter((pipe) => pipe.x + pipe.width > -20);

    for (const particle of game.particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += 500 * dt;
      particle.life -= dt;
    }
    game.particles = game.particles.filter((p) => p.life > 0);

    if (isCollision()) void collisionGameOver();
  }

  function circleRectCollision(cx, cy, r, rx, ry, rw, rh) {
    const nearX = Math.max(rx, Math.min(cx, rx + rw));
    const nearY = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - nearX;
    const dy = cy - nearY;
    return dx * dx + dy * dy <= r * r;
  }

  function isCollision() {
    const b = game.bird;
    if (b.y + b.r >= canvas.height - 26 || b.y - b.r <= 0) return true;
    return game.pipes.some((p) =>
      circleRectCollision(b.x, b.y, b.r, p.x, 0, p.width, p.top) ||
      circleRectCollision(b.x, b.y, b.r, p.x, p.bottom, p.width, canvas.height - p.bottom - 26)
    );
  }

  function addBurst(x, y) {
    for (let i = 0; i < 14; i += 1) {
      game.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 260,
        vy: (Math.random() - 0.5) * 260,
        life: 0.8 + Math.random() * 0.4
      });
    }
  }

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, '#70d4ff');
    sky.addColorStop(1, '#dff8ff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(255,255,255,.58)';
    for (let i = 0; i < 5; i += 1) {
      const x = ((i * 220 + performance.now() * 0.01) % 1100) - 100;
      const y = 78 + (i % 3) * 56;
      ctx.beginPath();
      ctx.arc(x, y, 26, 0, Math.PI * 2);
      ctx.arc(x + 28, y + 5, 20, 0, Math.PI * 2);
      ctx.arc(x - 26, y + 7, 18, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#58b55d';
    ctx.fillRect(0, canvas.height - 26, canvas.width, 26);
    ctx.fillStyle = '#348742';
    ctx.fillRect(0, canvas.height - 26, canvas.width, 7);
  }

  function drawPipes() {
    for (const p of game.pipes) {
      ctx.fillStyle = '#23a65a';
      ctx.fillRect(p.x, 0, p.width, p.top);
      ctx.fillRect(p.x, p.bottom, p.width, canvas.height - p.bottom - 26);

      ctx.fillStyle = '#43ca76';
      ctx.fillRect(p.x + 8, 0, 10, p.top);
      ctx.fillRect(p.x + 8, p.bottom, 10, canvas.height - p.bottom - 26);

      ctx.fillStyle = '#157c41';
      ctx.fillRect(p.x - 7, p.top - 22, p.width + 14, 22);
      ctx.fillRect(p.x - 7, p.bottom, p.width + 14, 22);
    }
  }

  function drawBird() {
    const b = game.bird;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(Math.max(-0.45, Math.min(0.65, b.vy / 800)));

    ctx.fillStyle = '#ffd84d';
    ctx.beginPath();
    ctx.arc(0, 0, b.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ff9d31';
    ctx.beginPath();
    ctx.moveTo(15, -2);
    ctx.lineTo(33, 4);
    ctx.lineTo(15, 10);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(8, -7, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#17212a';
    ctx.beginPath();
    ctx.arc(10, -7, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#efb62e';
    ctx.beginPath();
    ctx.ellipse(-8, 5, 12, 7, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawParticles() {
    ctx.fillStyle = '#ffd84d';
    for (const p of game.particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillRect(p.x, p.y, 5, 5);
    }
    ctx.globalAlpha = 1;
  }

  function drawScore() {
    ctx.save();
    ctx.font = '900 44px system-ui';
    ctx.textAlign = 'center';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,.25)';
    ctx.strokeText(String(game.score), canvas.width / 2, 64);
    ctx.fillStyle = '#fff';
    ctx.fillText(String(game.score), canvas.width / 2, 64);
    ctx.restore();
  }

  function render() {
    drawBackground();
    drawPipes();
    drawBird();
    drawParticles();
    if (game.mode === 'running') drawScore();
  }

  function frame(now) {
    if (disposed) return;
    const dt = Math.min(0.035, (now - (game.lastFrame || now)) / 1000);
    game.lastFrame = now;
    if (visible) update(dt);
    render();
    requestAnimationFrame(frame);
  }

  function triggerUp() {
    if (game.mode === 'running') void executeEvent('up');
  }

  function triggerDown() {
    if (game.mode === 'running') void executeEvent('down');
  }

  function bindEvents() {
    ui.connectBtn.addEventListener('click', () => void connectDevice());
    ui.disconnectBtn.addEventListener('click', () => void disconnectDevice());
    ui.startBtn.addEventListener('click', () => void startGame());
    ui.overlayStartBtn.addEventListener('click', () => void startGame());
    ui.stopBtn.addEventListener('click', () => void stopGame('Round Stopped'));
    ui.upBtn.addEventListener('click', triggerUp);
    ui.downBtn.addEventListener('click', triggerDown);
    ui.saveWorkspaceBtn.addEventListener('click', () => void saveWorkspace('Saved'));
    ui.resetWorkspaceBtn.addEventListener('click', () => void resetWorkspace());
    ui.clearLogBtn.addEventListener('click', () => { ui.commandLog.innerHTML = ''; });

    window.addEventListener('keydown', (event) => {
      if (event.repeat) return;
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        triggerUp();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        triggerDown();
      }
    });
  }

  async function initSdk() {
    if (!window.icreator) {
      ui.sdkWarning.classList.remove('hidden');
      ui.sdkWarning.textContent = 'Open this module in iCreator.';
      ui.connectBtn.disabled = true;
      log('Open this module in iCreator.', 'err');
      return;
    }

    sdk = window.icreator;

    try {
      sdkContext = await sdk.ready();
      console.info('[Flappy BLE ' + MODULE_VERSION + '] SDK ready', {
        apiVersion: sdkContext.apiVersion,
        platform: sdkContext.platform,
        module: sdkContext.module && sdkContext.module.id
      });

      try {
        const best = await sdk.storage.get(BEST_KEY);
        game.best = Number.isFinite(best) ? best : 0;
        updateScoreUi();
      } catch (error) {
        logError('Best score load', error);
      }

      offState = await sdk.device.watchState((state) => updateDeviceUi(state));

      offVisibility = sdk.lifecycle.onVisibilityChange((isVisible) => {
        visible = isVisible;
        if (!visible && game.mode === 'running') {
          game.eventRunToken += 1;
          setRuntimeState('Paused while hidden');
        } else if (visible && game.mode === 'running') {
          game.eventRunToken += 1;
          setRuntimeState('Running frozen blocks', true);
        }
      });

      sdk.lifecycle.onDispose(() => dispose());

      updateDeviceUi(await sdk.device.getState());
    } catch (error) {
      ui.sdkWarning.classList.remove('hidden');
      ui.sdkWarning.textContent = 'iCreator initialization failed: ' + (error.message || String(error));
      logError('SDK initialization', error);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    visible = false;
    game.eventRunToken += 1;

    if (saveTimer) clearTimeout(saveTimer);
    if (offState) offState();
    if (offVisibility) offVisibility();
    if (resizeObserver) resizeObserver.disconnect();
    if (game.runtimeWorkspace) game.runtimeWorkspace.dispose();
    if (workspace) workspace.dispose();

    // Do not disconnect the shared Bluetooth device here.
    console.info('[Flappy BLE ' + MODULE_VERSION + '] disposed');
  }

  async function init() {
    bindEvents();
    render();
    updatePhysicsUi();
    updateScoreUi();

    try {
      await initSdk();
      await initBlockly();
      if (latestState) updateDeviceUi(latestState);
      setWorkspaceStatus('Blockly ready.', 'ok');
    } catch (error) {
      ui.sdkWarning.classList.remove('hidden');
      ui.sdkWarning.textContent = 'Module startup failed: ' + (error.message || String(error));
      logError('Module startup', error);
    }

    requestAnimationFrame(frame);
  }

  void init();
})();