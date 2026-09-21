(() => {
  'use strict';

  const VERSION = '3.1.0';
  const WORKSPACE_KEY = 'deviceWorkspace.v3';
  const META_KEY = 'deviceWorkspace.meta.v3';
  const BACKUP_KEY = 'deviceWorkspace.backup.v3';
  const READBACK_KEY = 'deviceReadback.raw.v3';
  const BEST_KEY = 'bestScore';
  const MAX_WORKSPACE_BYTES = 256 * 1024;
  const MAX_READ_BYTES = 256 * 1024;
  const FIRST_BYTE_TIMEOUT = 5000;
  const IDLE_TIMEOUT = 5000;
  const TOTAL_TIMEOUT = 60000;
  const BLE_MIN_INTERVAL = 120;

  const $ = (id) => document.getElementById(id);
  const canvas = $('gameCanvas');
  const ctx = canvas.getContext('2d');

  const ui = {
    sdkWarning: $('sdkWarning'),
    deviceStatus: $('deviceStatus'),
    connectBtn: $('connectBtn'),
    disconnectBtn: $('disconnectBtn'),
    startBtn: $('startBtn'),
    overlayStartBtn: $('overlayStartBtn'),
    overlay: $('overlay'),
    overlayTitle: $('overlayTitle'),
    overlayText: $('overlayText'),
    upBtn: $('upBtn'),
    downBtn: $('downBtn'),
    score: $('score'),
    best: $('best'),
    commandLog: $('commandLog'),
    clearLogBtn: $('clearLogBtn'),
    blocklyDiv: $('blocklyDiv'),
    saveBtn: $('saveBtn'),
    starterBtn: $('starterBtn'),
    workspaceStatus: $('workspaceStatus'),
    blocklyVersion: $('blocklyVersion'),
    codePreview: $('codePreview'),
    codeStatus: $('codeStatus'),
    uploadBtn: $('uploadBtn'),
    readBtn: $('readBtn'),
    cancelUploadBtn: $('cancelUploadBtn'),
    progressBar: $('progressBar'),
    transferStatus: $('transferStatus')
  };

  let sdk = null;
  let sdkContext = null;
  let latestState = null;
  let workspace = null;
  let disposed = false;
  let visible = true;
  let offState = null;
  let offVisibility = null;
  let resizeObserver = null;
  let saveTimer = null;
  let uploadJobId = null;
  let readbackActive = null;
  let bleLastSendAt = 0;
  let gameSendInFlight = false;
  let pendingGameEvent = null;
  let urgentStopPending = false;

  const game = {
    mode: 'ready',
    score: 0,
    best: 0,
    lastFrame: 0,
    spawnTimer: 0,
    bird: {x: 180, y: 250, vy: 0, r: 18},
    pipes: [],
    particles: []
  };

  function log(message, type = 'muted') {
    const row = document.createElement('div');
    row.className = type;
    row.textContent = '[' + new Date().toLocaleTimeString() + '] ' + message;
    ui.commandLog.appendChild(row);
    while (ui.commandLog.childElementCount > 180) {
      ui.commandLog.removeChild(ui.commandLog.firstChild);
    }
    ui.commandLog.scrollTop = ui.commandLog.scrollHeight;
  }

  function fail(operation, error) {
    const message = error && error.message ? error.message : String(error || 'Unknown error');
    console.error('[Flappy BLE v' + VERSION + '] ' + operation + ' failed', error);
    log(operation + ' failed: ' + message, 'err');
    return message;
  }

  function setTransfer(message, progress = 0) {
    ui.transferStatus.textContent = message;
    ui.progressBar.style.width = Math.max(0, Math.min(100, progress)) + '%';
  }

  function setWorkspaceStatus(message, type = '') {
    ui.workspaceStatus.textContent = message;
    ui.workspaceStatus.className = type;
  }

  function updateScore() {
    ui.score.textContent = String(game.score);
    ui.best.textContent = String(game.best);
  }

  function starterWorkspace() {
    return {
      blocks: {
        languageVersion: 0,
        blocks: [{
          type: 'flappy_device_program',
          id: 'device_root',
          x: 36,
          y: 32,
          inputs: {
            BODY: {
              block: {
                type: 'flappy_on_message',
                id: 'on_moveup',
                fields: {MESSAGE: 'moveup'},
                inputs: {
                  DO: {
                    block: {
                      type: 'flappy_motor',
                      id: 'moveup_left',
                      fields: {SIDE: 'LEFT', DIR: 'FORWARD', SPEED: 50},
                      next: {
                        block: {
                          type: 'flappy_motor',
                          id: 'moveup_right',
                          fields: {SIDE: 'RIGHT', DIR: 'FORWARD', SPEED: 50}
                        }
                      }
                    }
                  }
                },
                next: {
                  block: {
                    type: 'flappy_on_message',
                    id: 'on_left',
                    fields: {MESSAGE: 'left'},
                    inputs: {
                      DO: {
                        block: {
                          type: 'flappy_motor_stop',
                          id: 'left_stop',
                          fields: {SIDE: 'LEFT'},
                          next: {
                            block: {
                              type: 'flappy_motor',
                              id: 'right_forward',
                              fields: {SIDE: 'RIGHT', DIR: 'FORWARD', SPEED: 60}
                            }
                          }
                        }
                      }
                    },
                    next: {
                      block: {
                        type: 'flappy_on_message',
                        id: 'on_right',
                        fields: {MESSAGE: 'right'},
                        inputs: {
                          DO: {
                            block: {
                              type: 'flappy_motor',
                              id: 'left_forward',
                              fields: {SIDE: 'LEFT', DIR: 'FORWARD', SPEED: 60},
                              next: {
                                block: {
                                  type: 'flappy_motor_stop',
                                  id: 'right_stop',
                                  fields: {SIDE: 'RIGHT'}
                                }
                              }
                            }
                          }
                        },
                        next: {
                          block: {
                            type: 'flappy_on_message',
                            id: 'on_stop',
                            fields: {MESSAGE: 'stop'},
                            inputs: {
                              DO: {
                                block: {
                                  type: 'flappy_motor_stop',
                                  id: 'stop_left',
                                  fields: {SIDE: 'LEFT'},
                                  next: {
                                    block: {
                                      type: 'flappy_motor_stop',
                                      id: 'stop_right',
                                      fields: {SIDE: 'RIGHT'}
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }]
      }
    };
  }

  function validateBlocklyRuntime() {
    if (!window.Blockly || !window.FlappyDeviceBlocks || !window.FlappyCrowbotAdapter) {
      throw new Error('Bundled Blockly runtime, device blocks, or Crowbot adapter is missing.');
    }
    if (!window.Blockly.serialization || !window.Blockly.serialization.workspaces) {
      throw new Error('Bundled Blockly does not expose workspace JSON serialization.');
    }
  }

  async function initBlockly() {
    validateBlocklyRuntime();
    const Blockly = window.Blockly;

    ui.blocklyVersion.textContent = 'Blockly ' + (Blockly.VERSION || 'bundled');
    workspace = Blockly.inject(ui.blocklyDiv, {
      toolbox: window.FlappyDeviceBlocks.toolbox,
      renderer: 'zelos',
      trashcan: true,
      move: {scrollbars: true, drag: true, wheel: true},
      zoom: {controls: true, wheel: true, startScale: 0.88, minScale: 0.45, maxScale: 1.4, scaleSpeed: 1.08},
      grid: {spacing: 24, length: 3, colour: '#29475d', snap: true}
    });

    resizeObserver = new ResizeObserver(() => {
      if (workspace) Blockly.svgResize(workspace);
    });
    resizeObserver.observe(ui.blocklyDiv);

    workspace.addChangeListener((event) => {
      if (!event || event.isUiEvent || disposed) return;
      updateCodePreview();
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void saveWorkspace('Autosaved'), 600);
    });

    await restoreWorkspace();
    updateCodePreview();
    Blockly.svgResize(workspace);
  }

  async function restoreWorkspace() {
    let restored = false;
    if (sdk) {
      try {
        const saved = await sdk.storage.get(WORKSPACE_KEY);
        if (saved && typeof saved === 'object') {
          const temp = new window.Blockly.Workspace();
          try {
            window.Blockly.serialization.workspaces.load(saved, temp);
            window.FlappyCrowbotAdapter.inspectWorkspace(temp);
            temp.dispose();
            window.Blockly.serialization.workspaces.load(saved, workspace);
            restored = true;
            setWorkspaceStatus('Saved device blocks restored.', 'ok');
          } catch (error) {
            temp.dispose();
            fail('Saved device workspace validation', error);
          }
        }
      } catch (error) {
        fail('Device workspace storage read', error);
      }
    }

    if (!restored) {
      window.Blockly.serialization.workspaces.load(starterWorkspace(), workspace);
      setWorkspaceStatus('Starter Crowbot program loaded.');
    }
  }

  function frozenSnapshot() {
    if (!workspace) throw new Error('Device Blockly is not ready.');
    const snapshot = window.Blockly.serialization.workspaces.save(workspace);
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).length;
    if (bytes > MAX_WORKSPACE_BYTES) throw new Error('Blockly workspace exceeds 256 KiB.');
    return snapshot;
  }

  function generateFromSnapshot(snapshot) {
    return window.FlappyCrowbotAdapter.generateFromSnapshot(snapshot, window.Blockly);
  }

  function updateCodePreview(label = 'Preview') {
    if (!workspace) return;
    try {
      const snapshot = frozenSnapshot();
      const source = generateFromSnapshot(snapshot);
      ui.codePreview.textContent = source;
      ui.codeStatus.textContent = label;
      ui.codeStatus.className = 'pill ok';
    } catch (error) {
      ui.codePreview.textContent = '# ' + (error.message || String(error));
      ui.codeStatus.textContent = 'Invalid blocks';
      ui.codeStatus.className = 'pill err';
    }
  }

  async function saveWorkspace(label = 'Saved') {
    if (!sdk || !workspace) return false;
    try {
      const snapshot = frozenSnapshot();
      const metadata = {
        workspaceSchemaVersion: 3,
        blockSetId: window.FlappyDeviceBlocks.blockSetId,
        blockSetVersion: window.FlappyDeviceBlocks.blockSetVersion,
        generatorVersion: window.FlappyDeviceBlocks.generatorVersion,
        adapterId: window.FlappyCrowbotAdapter.id,
        adapterVersion: window.FlappyCrowbotAdapter.version,
        expectedFirmwareVersion: window.FlappyCrowbotAdapter.expectedFirmware,
        timestamp: new Date().toISOString(),
        provenance: 'local-editor'
      };
      await sdk.storage.set(WORKSPACE_KEY, snapshot);
      await sdk.storage.set(META_KEY, metadata);
      setWorkspaceStatus(label + '.', 'ok');
      return true;
    } catch (error) {
      fail('Save device workspace', error);
      setWorkspaceStatus('Save failed.', 'err');
      return false;
    }
  }

  async function restoreStarter() {
    if (!workspace) return;
    if (!window.confirm('Replace the device editor with the starter Crowbot program?')) return;
    try {
      await backupCurrentWorkspace('before-starter-reset');
      window.Blockly.serialization.workspaces.load(starterWorkspace(), workspace);
      updateCodePreview();
      await saveWorkspace('Starter blocks saved');
    } catch (error) {
      fail('Restore starter program', error);
    }
  }

  async function backupCurrentWorkspace(reason) {
    if (!sdk || !workspace) return;
    try {
      const snapshot = window.Blockly.serialization.workspaces.save(workspace);
      await sdk.storage.set(BACKUP_KEY, {
        reason,
        timestamp: new Date().toISOString(),
        workspace: snapshot
      });
    } catch (error) {
      fail('Local workspace backup', error);
    }
  }

  function updateDeviceUi(state) {
    latestState = state;
    const device = state && state.currentDevice;
    const busy = !!(state && state.activity);
    const profileOk = device && device.profileId === window.FlappyCrowbotAdapter.profileId;

    if (device) {
      ui.deviceStatus.textContent = device.name + (busy ? ' · Busy' : ' · Connected');
      ui.deviceStatus.className = 'status ' + (busy ? 'busy' : 'connected');
      ui.connectBtn.disabled = true;
      ui.disconnectBtn.disabled = false;
      ui.uploadBtn.disabled = !profileOk || busy || !!readbackActive;
      ui.readBtn.disabled = !profileOk || busy || !!readbackActive;
    } else {
      ui.deviceStatus.textContent = 'Disconnected';
      ui.deviceStatus.className = 'status disconnected';
      ui.connectBtn.disabled = !sdk;
      ui.disconnectBtn.disabled = true;
      ui.uploadBtn.disabled = true;
      ui.readBtn.disabled = true;
    }
  }

  async function connectDevice() {
    if (!sdk || !visible) return;
    try {
      ui.connectBtn.disabled = true;
      setTransfer('Opening device chooser…', 0);
      const state = await sdk.device.connect({profileId: window.FlappyCrowbotAdapter.profileId});
      updateDeviceUi(state);
      setTransfer(state.currentDevice ? 'Connected.' : 'No device selected.', 0);
      if (state.currentDevice) log('Connected to ' + state.currentDevice.name + '.', 'ok');
    } catch (error) {
      fail('Connect Bluetooth', error);
      setTransfer(error && error.message ? error.message : 'Connect failed.', 0);
      try { updateDeviceUi(await sdk.device.getState()); } catch (_) {}
    }
  }

  async function disconnectDevice() {
    if (!sdk || !visible) return;
    try {
      abortReadback(new Error('Readback canceled because the device is disconnecting.'));
      const state = await sdk.device.getState();
      if (!state.currentDevice) return;
      await sdk.device.disconnect({
        deviceId: state.currentDevice.deviceId,
        connectionId: state.currentDevice.connectionId
      });
      log('Bluetooth disconnected.', 'ok');
      setTransfer('Disconnected.', 0);
    } catch (error) {
      fail('Disconnect Bluetooth', error);
    }
  }

  async function uploadToDevice() {
    if (!sdk || !workspace || !visible || uploadJobId || readbackActive) return;

    let offJob = null;
    try {
      const state = await sdk.device.getState();
      const target = state.currentDevice;
      if (!target) throw new Error('Connect a compatible Crowbot first.');
      if (target.profileId !== window.FlappyCrowbotAdapter.profileId) {
        throw new Error('This editor requires the Crowbot compatibility profile.');
      }
      if (state.activity) throw new Error('The shared device is busy.');

      const snapshot = frozenSnapshot();
      const source = generateFromSnapshot(snapshot);
      await saveWorkspace('Saved before upload');

      setTransfer('Preparing upload…', 2);
      ui.uploadBtn.disabled = true;
      ui.readBtn.disabled = true;

      const clientRequestId = crypto.randomUUID();
      const created = await sdk.device.upload({
        deviceId: target.deviceId,
        connectionId: target.connectionId,
        profileId: target.profileId,
        clientRequestId,
        artifact: {
          kind: 'micropython',
          source,
          workspacePolicy: 'replace',
          workspace: snapshot
        }
      });

      uploadJobId = created.jobId;
      ui.cancelUploadBtn.classList.remove('hidden');

      offJob = await sdk.device.watchUpload(uploadJobId, (status) => {
        const p = Number.isFinite(status.progress) ? status.progress * (status.progress <= 1 ? 100 : 1) : 0;
        setTransfer('Upload: ' + (status.phase || status.status || 'working'), p);
      });

      const result = await sdk.device.waitForUpload(uploadJobId);
      setTransfer('Upload acknowledged by device.', 100);
      log('Device upload acknowledged. This confirms transfer/reload acknowledgement, not every hardware behavior.', 'ok');

      await sdk.storage.set(META_KEY, {
        workspaceSchemaVersion: 3,
        blockSetId: window.FlappyDeviceBlocks.blockSetId,
        blockSetVersion: window.FlappyDeviceBlocks.blockSetVersion,
        generatorVersion: window.FlappyDeviceBlocks.generatorVersion,
        adapterId: window.FlappyCrowbotAdapter.id,
        adapterVersion: window.FlappyCrowbotAdapter.version,
        expectedFirmwareVersion: window.FlappyCrowbotAdapter.expectedFirmware,
        timestamp: new Date().toISOString(),
        provenance: 'uploaded-to-device',
        confirmation: result && result.confirmation ? result.confirmation : 'device-confirmed'
      });
    } catch (error) {
      fail('Upload to device', error);
      setTransfer('Upload failed: ' + (error.message || String(error)), 0);
    } finally {
      if (offJob) {
        try { offJob(); } catch (_) {}
      }
      uploadJobId = null;
      ui.cancelUploadBtn.classList.add('hidden');
      try { updateDeviceUi(await sdk.device.getState()); } catch (_) {}
    }
  }

  async function cancelUpload() {
    if (!sdk || !uploadJobId) return;
    try {
      await sdk.device.cancelUpload(uploadJobId);
      setTransfer('Upload canceled. Device state may be partial; retry the whole upload when ready.', 0);
      log('Upload canceled. Cancellation is not rollback.', 'err');
    } catch (error) {
      fail('Cancel upload', error);
    }
  }

  function createReadbackSession(target, projectSessionId) {
    const decoder = new TextDecoder('utf-8', {fatal: true});
    let buffer = '';
    let byteCount = 0;
    let gotFirstByte = false;
    let firstTimer = null;
    let idleTimer = null;
    let totalTimer = null;
    let offData = null;
    let settled = false;

    let resolveResult;
    let rejectResult;
    const promise = new Promise((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    function cleanup() {
      if (firstTimer) clearTimeout(firstTimer);
      if (idleTimer) clearTimeout(idleTimer);
      if (totalTimer) clearTimeout(totalTimer);
      if (offData) {
        try { offData(); } catch (_) {}
      }
    }

    function reject(error) {
      if (settled) return;
      settled = true;
      cleanup();
      rejectResult(error);
    }

    function resolve(value) {
      if (settled) return;
      settled = true;
      cleanup();
      resolveResult(value);
    }

    function armIdle() {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => reject(new Error('Device workspace read timed out while waiting for more data.')), IDLE_TIMEOUT);
    }

    function feed(event) {
      if (settled) return;
      if (event.deviceId !== target.deviceId || event.connectionId !== target.connectionId) return;
      if (event.projectSessionId && event.projectSessionId !== projectSessionId) return;

      const data = Array.isArray(event.data) ? event.data : [];
      if (!data.length) return;

      if (!gotFirstByte) {
        gotFirstByte = true;
        if (firstTimer) clearTimeout(firstTimer);
      }
      armIdle();

      byteCount += data.length;
      if (byteCount > MAX_READ_BYTES) {
        reject(new Error('Device workspace exceeded the 256 KiB readback limit.'));
        return;
      }

      let textChunk;
      try {
        textChunk = decoder.decode(new Uint8Array(data), {stream: true});
      } catch (error) {
        reject(new Error('Device returned invalid UTF-8 workspace data: ' + error.message));
        return;
      }

      const trimmedChunk = textChunk.trim();
      if (!buffer && (trimmedChunk === 'upload:ok' || trimmedChunk === 'upload:error')) return;

      buffer += textChunk;

      const complete = findCompleteJson(buffer);
      if (complete.error) {
        reject(new Error(complete.error));
        return;
      }
      if (!complete.complete) return;

      const trailing = buffer.slice(complete.end).trim();
      if (trailing) {
        reject(new Error('Unexpected mixed telemetry followed the workspace JSON.'));
        return;
      }

      try {
        const parsed = JSON.parse(buffer.slice(0, complete.end));
        if (!parsed || typeof parsed !== 'object' || !parsed.blocks) {
          throw new Error('Returned JSON is not a Blockly workspace.');
        }
        resolve({workspace: parsed, raw: buffer.slice(0, complete.end), bytes: byteCount});
      } catch (error) {
        reject(new Error('Device returned invalid Blockly workspace JSON: ' + error.message));
      }
    }

    firstTimer = setTimeout(() => reject(new Error('No workspace data arrived from the device within 5 seconds.')), FIRST_BYTE_TIMEOUT);
    totalTimer = setTimeout(() => reject(new Error('Device workspace read exceeded the 60 second total timeout.')), TOTAL_TIMEOUT);

    return {
      target,
      promise,
      feed,
      reject,
      setOffData(fn) { offData = fn; },
      isSettled() { return settled; }
    };
  }

  function findCompleteJson(text) {
    let start = 0;
    while (start < text.length && /\s/.test(text[start])) start += 1;
    if (start >= text.length) return {complete: false};

    const first = text[start];
    if (first !== '{') {
      return {complete: false, error: 'Unexpected device data before workspace JSON; mixed telemetry cannot be safely stripped.'};
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{' || ch === '[') depth += 1;
      else if (ch === '}' || ch === ']') {
        depth -= 1;
        if (depth < 0) return {complete: false, error: 'Malformed workspace JSON structure.'};
        if (depth === 0) return {complete: true, end: i + 1};
      }
    }

    return {complete: false};
  }

  async function readBlocksFromDevice() {
    if (!sdk || !workspace || !visible || readbackActive || uploadJobId) return;

    let session = null;
    try {
      const state = await sdk.device.getState();
      const target = state.currentDevice;
      if (!target) throw new Error('Connect a compatible Crowbot first.');
      if (target.profileId !== window.FlappyCrowbotAdapter.profileId) {
        throw new Error('Workspace readback is enabled only for the Crowbot compatibility profile.');
      }
      if (state.activity) throw new Error('The shared device is busy.');

      setTransfer('Waiting for device workspace…', 4);
      ui.readBtn.disabled = true;
      ui.uploadBtn.disabled = true;

      session = createReadbackSession(target, state.projectSessionId);
      readbackActive = session;

      // Subscribe before the request so an immediate response cannot be lost.
      const offData = await sdk.device.onData((event) => session.feed(event));
      session.setOffData(offData);

      await sdk.device.send({
        deviceId: target.deviceId,
        connectionId: target.connectionId,
        text: 'get_device_block_xml'
      });

      const result = await session.promise;
      setTransfer('Workspace received. Validating blocks…', 70);

      // Preserve the raw recovered workspace before attempting compatibility validation.
      try {
        await sdk.storage.set(READBACK_KEY, {
          timestamp: new Date().toISOString(),
          provenance: 'device-readback',
          workspace: result.workspace
        });
      } catch (error) {
        log('Readback was received but could not be persisted as raw backup: ' + (error.message || String(error)), 'err');
      }

      const temp = new window.Blockly.Workspace();
      try {
        window.Blockly.serialization.workspaces.load(result.workspace, temp);
        window.FlappyCrowbotAdapter.inspectWorkspace(temp);
      } finally {
        temp.dispose();
      }

      if (!window.confirm('Device blocks were read successfully. Replace the current editor with the device workspace?')) {
        setTransfer('Device workspace kept as readback backup; editor not replaced.', 100);
        log('Device workspace read successfully; current edits were kept.', 'ok');
        return;
      }

      await backupCurrentWorkspace('before-device-readback-replace');
      window.Blockly.serialization.workspaces.load(result.workspace, workspace);
      updateCodePreview('Generated from recovered blocks');
      await sdk.storage.set(WORKSPACE_KEY, result.workspace);
      await sdk.storage.set(META_KEY, {
        workspaceSchemaVersion: 3,
        blockSetId: window.FlappyDeviceBlocks.blockSetId,
        blockSetVersion: window.FlappyDeviceBlocks.blockSetVersion,
        generatorVersion: window.FlappyDeviceBlocks.generatorVersion,
        adapterId: window.FlappyCrowbotAdapter.id,
        adapterVersion: window.FlappyCrowbotAdapter.version,
        expectedFirmwareVersion: window.FlappyCrowbotAdapter.expectedFirmware,
        timestamp: new Date().toISOString(),
        provenance: 'device-readback'
      });

      setWorkspaceStatus('Device workspace restored and editable.', 'ok');
      setTransfer('Readback complete.', 100);
      log('Read ' + result.bytes + ' bytes of Blockly workspace from device.', 'ok');
    } catch (error) {
      fail('Read blocks from device', error);
      setTransfer('Read failed: ' + (error.message || String(error)), 0);
      if (session) session.reject(error);
    } finally {
      readbackActive = null;
      try { updateDeviceUi(await sdk.device.getState()); } catch (_) {}
    }
  }

  function abortReadback(error) {
    if (readbackActive && !readbackActive.isSettled()) {
      readbackActive.reject(error || new Error('Readback canceled.'));
    }
    readbackActive = null;
  }

  function queueGameCommand(text, options = {}) {
    const command = String(text);
    const urgent = options.urgent === true;

    if (urgent) {
      // STOP is a terminal game state. Drop any queued nonterminal event so
      // stale gameplay commands cannot run after death.
      pendingGameEvent = null;
      urgentStopPending = true;
      void pumpGameCommandQueue();
      return;
    }

    if (urgentStopPending || game.mode === 'over') {
      log('Dropped stale game event "' + command + '" because STOP is pending.', 'muted');
      return;
    }

    // Normal game events are state notifications, not a command history.
    // While a BLE write is in flight, keep only the newest pending event.
    pendingGameEvent = command;
    void pumpGameCommandQueue();
  }

  async function pumpGameCommandQueue() {
    if (gameSendInFlight || disposed || !visible || !sdk) return;

    let command = null;
    let urgent = false;

    if (urgentStopPending) {
      urgentStopPending = false;
      command = 'stop';
      urgent = true;
      pendingGameEvent = null;
    } else if (pendingGameEvent) {
      command = pendingGameEvent;
      pendingGameEvent = null;
    }

    if (!command) return;

    gameSendInFlight = true;
    try {
      const waitMs = Math.max(0, BLE_MIN_INTERVAL - (performance.now() - bleLastSendAt));
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));

      const state = await sdk.device.getState();
      const target = state.currentDevice;
      if (!target) {
        log('Game event "' + command + '" not sent: no device connected.', 'err');
        return;
      }
      if (state.activity) {
        log('Game event "' + command + '" not sent: shared device is busy; event is not replayed.', 'err');
        return;
      }

      bleLastSendAt = performance.now();
      await sdk.device.send({
        deviceId: target.deviceId,
        connectionId: target.connectionId,
        text: command
      });
      log((urgent ? 'URGENT ' : '') + 'Game → BLE: ' + command, 'ok');
    } catch (error) {
      fail('Send game event "' + command + '"', error);
    } finally {
      gameSendInFlight = false;

      // STOP always wins over anything queued while the previous write was active.
      if (urgentStopPending || pendingGameEvent) {
        void pumpGameCommandQueue();
      }
    }
  }

  function startGame() {
    if (game.mode === 'running') return;
    game.mode = 'running';
    game.score = 0;
    game.spawnTimer = 0;
    game.bird.x = 180;
    game.bird.y = canvas.height * 0.48;
    game.bird.vy = 0;
    game.pipes = [];
    game.particles = [];
    game.lastFrame = performance.now();
    updateScore();
    ui.overlay.classList.add('hidden');
    pendingGameEvent = null;
    urgentStopPending = false;
    queueGameCommand('start');
  }

  function triggerUp() {
    if (game.mode !== 'running') return;
    game.bird.vy = -430;
  }

  function triggerDown() {
    if (game.mode !== 'running') return;
    game.bird.vy = Math.max(game.bird.vy + 360, 340);
  }

  async function gameOver() {
    if (game.mode !== 'running') return;
    game.mode = 'over';
    addBurst(game.bird.x, game.bird.y);

    if (game.score > game.best) {
      game.best = game.score;
      updateScore();
      if (sdk) {
        try { await sdk.storage.set(BEST_KEY, game.best); }
        catch (error) { fail('Save best score', error); }
      }
    }

    ui.overlayTitle.textContent = 'Game Over';
    ui.overlayText.textContent = 'Score: ' + game.score + ' · Best: ' + game.best;
    ui.overlayStartBtn.textContent = 'Play Again';
    ui.overlay.classList.remove('hidden');
    queueGameCommand('stop', {urgent: true});
  }

  function spawnPipe() {
    const gap = 150;
    const margin = 78;
    const minCenter = margin + gap / 2;
    const maxCenter = canvas.height - 26 - margin - gap / 2;
    const center = minCenter + Math.random() * (maxCenter - minCenter);
    game.pipes.push({
      x: canvas.width + 40,
      width: 70,
      top: center - gap / 2,
      bottom: center + gap / 2,
      scored: false
    });
  }

  function updateGame(dt) {
    if (game.mode !== 'running') return;

    const b = game.bird;
    b.vy += 1250 * dt;
    b.y += b.vy * dt;

    game.spawnTimer += dt;
    if (game.spawnTimer >= 1.45) {
      game.spawnTimer -= 1.45;
      spawnPipe();
    }

    for (const p of game.pipes) {
      p.x -= 235 * dt;
      if (!p.scored && p.x + p.width < b.x) {
        p.scored = true;
        game.score += 1;
        updateScore();
        queueGameCommand('pipe');
        if (game.score % 5 === 0) {
          queueGameCommand('milestone');
        }
      }
    }
    game.pipes = game.pipes.filter((p) => p.x + p.width > -20);

    for (const p of game.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 500 * dt;
      p.life -= dt;
    }
    game.particles = game.particles.filter((p) => p.life > 0);

    if (isCollision()) void gameOver();
  }

  function circleRectCollision(cx, cy, r, rx, ry, rw, rh) {
    const nx = Math.max(rx, Math.min(cx, rx + rw));
    const ny = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - nx;
    const dy = cy - ny;
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
    sky.addColorStop(0, '#74d6ff');
    sky.addColorStop(1, '#e3f9ff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(255,255,255,.58)';
    for (let i = 0; i < 5; i += 1) {
      const x = ((i * 220 + performance.now() * 0.01) % 1100) - 100;
      const y = 80 + (i % 3) * 55;
      ctx.beginPath();
      ctx.arc(x, y, 26, 0, Math.PI * 2);
      ctx.arc(x + 28, y + 5, 20, 0, Math.PI * 2);
      ctx.arc(x - 26, y + 7, 18, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#59b65d';
    ctx.fillRect(0, canvas.height - 26, canvas.width, 26);
    ctx.fillStyle = '#368a44';
    ctx.fillRect(0, canvas.height - 26, canvas.width, 7);
  }

  function drawPipes() {
    for (const p of game.pipes) {
      ctx.fillStyle = '#24a65a';
      ctx.fillRect(p.x, 0, p.width, p.top);
      ctx.fillRect(p.x, p.bottom, p.width, canvas.height - p.bottom - 26);
      ctx.fillStyle = '#42c875';
      ctx.fillRect(p.x + 8, 0, 10, p.top);
      ctx.fillRect(p.x + 8, p.bottom, 10, canvas.height - p.bottom - 26);
      ctx.fillStyle = '#168043';
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

  function renderGame() {
    drawBackground();
    drawPipes();
    drawBird();
    drawParticles();
    if (game.mode === 'running') {
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
  }

  function frame(now) {
    if (disposed) return;
    const dt = Math.min(0.035, (now - (game.lastFrame || now)) / 1000);
    game.lastFrame = now;
    if (visible) updateGame(dt);
    renderGame();
    requestAnimationFrame(frame);
  }

  function bindEvents() {
    ui.connectBtn.addEventListener('click', () => void connectDevice());
    ui.disconnectBtn.addEventListener('click', () => void disconnectDevice());
    ui.startBtn.addEventListener('click', startGame);
    ui.overlayStartBtn.addEventListener('click', startGame);
    ui.upBtn.addEventListener('click', triggerUp);
    ui.downBtn.addEventListener('click', triggerDown);
    ui.saveBtn.addEventListener('click', () => void saveWorkspace('Saved'));
    ui.starterBtn.addEventListener('click', () => void restoreStarter());
    ui.uploadBtn.addEventListener('click', () => void uploadToDevice());
    ui.readBtn.addEventListener('click', () => void readBlocksFromDevice());
    ui.cancelUploadBtn.addEventListener('click', () => void cancelUpload());
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
      ui.connectBtn.disabled = true;
      setTransfer('Open this module in iCreator.', 0);
      return;
    }

    sdk = window.icreator;
    sdkContext = await sdk.ready();

    try {
      const best = await sdk.storage.get(BEST_KEY);
      game.best = Number.isFinite(best) ? best : 0;
      updateScore();
    } catch (error) {
      fail('Load best score', error);
    }

    offState = await sdk.device.watchState((state) => {
      latestState = state;
      updateDeviceUi(state);

      if (readbackActive && state.activity && state.activity.owner) {
        const moduleInfo = sdkContext && sdkContext.module ? sdkContext.module : {};
        const owner = state.activity.owner;
        const isOurModule = owner.type === 'module' && (
          owner.id === moduleInfo.id ||
          owner.id === moduleInfo.instanceId
        );
        if (!isOurModule && state.activity.kind !== 'send') {
          abortReadback(new Error('Readback aborted because another client started a device operation.'));
        }
      }

      if (readbackActive) {
        const sessionDevice = readbackActive.target;
        if (!state.currentDevice) {
          abortReadback(new Error('Readback aborted because the Bluetooth device disconnected.'));
        } else if (sessionDevice && (
          state.currentDevice.deviceId !== sessionDevice.deviceId ||
          state.currentDevice.connectionId !== sessionDevice.connectionId
        )) {
          abortReadback(new Error('Readback aborted because the Bluetooth connection changed.'));
        }
      }
    });

    offVisibility = sdk.lifecycle.onVisibilityChange((isVisible) => {
      visible = isVisible;
      if (!visible) {
        abortReadback(new Error('Readback canceled because the module became hidden.'));
      }
    });

    sdk.lifecycle.onDispose(() => dispose());
    updateDeviceUi(await sdk.device.getState());
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    visible = false;
    abortReadback(new Error('Module closed.'));
    if (saveTimer) clearTimeout(saveTimer);
    if (offState) offState();
    if (offVisibility) offVisibility();
    if (resizeObserver) resizeObserver.disconnect();
    if (workspace) workspace.dispose();
    console.info('[Flappy BLE v' + VERSION + '] disposed without disconnecting shared BLE');
  }

  async function init() {
    bindEvents();
    renderGame();

    try {
      await initSdk();
      await initBlockly();
      if (latestState) updateDeviceUi(latestState);
      console.info('[Flappy BLE v' + VERSION + '] ready');
    } catch (error) {
      ui.sdkWarning.classList.remove('hidden');
      ui.sdkWarning.textContent = 'Module startup failed: ' + fail('Startup', error);
    }

    requestAnimationFrame(frame);
  }

  void init();
})();