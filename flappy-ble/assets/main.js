(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const canvas = $('gameCanvas');
  const ctx = canvas.getContext('2d');

  const ui = {
    sdkWarning: $('sdkWarning'),
    deviceStatus: $('deviceStatus'),
    connectBtn: $('connectBtn'),
    disconnectBtn: $('disconnectBtn'),
    startBtn: $('startBtn'),
    overlay: $('overlay'),
    overlayTitle: $('overlayTitle'),
    overlayText: $('overlayText'),
    upBtn: $('upBtn'),
    downBtn: $('downBtn'),
    score: $('score'),
    best: $('best'),
    cmdStart: $('cmdStart'),
    cmdUp: $('cmdUp'),
    cmdDown: $('cmdDown'),
    cmdStop: $('cmdStop'),
    saveBtn: $('saveBtn'),
    clearLogBtn: $('clearLogBtn'),
    commandLog: $('commandLog')
  };

  const DEFAULTS = {
    start: 'moveup',
    up: 'left',
    down: 'right',
    stop: 'stop'
  };

  const game = {
    mode: 'ready',
    score: 0,
    best: 0,
    lastFrame: 0,
    spawnTimer: 0,
    stopSent: false,
    bird: { x: 180, y: 250, vy: 0, r: 18 },
    pipes: [],
    particles: []
  };

  let sdk = null;
  let sdkContext = null;
  let latestState = null;
  let offState = null;
  let offDispose = null;
  let offVisibility = null;
  let visible = true;
  let lastControlSend = 0;

  function log(message, type = 'muted') {
    const row = document.createElement('div');
    row.className = type;
    row.textContent = '[' + new Date().toLocaleTimeString() + '] ' + message;
    ui.commandLog.appendChild(row);
    ui.commandLog.scrollTop = ui.commandLog.scrollHeight;
  }

  function niceError(error) {
    if (!error) return 'Unknown error';
    const code = error.code ? String(error.code) : '';
    const message = error.message ? String(error.message) : String(error);
    const known = {
      USER_CANCELED: 'Device selection was canceled.',
      UNSUPPORTED: 'Bluetooth is not supported here.',
      NOT_CONNECTED: 'No Bluetooth device is connected.',
      STALE_CONNECTION: 'The Bluetooth connection changed. Please try again.',
      BUSY: 'The Bluetooth device is busy.',
      PERMISSION_DENIED: 'Bluetooth permission was denied.',
      PAYLOAD_TOO_LARGE: 'This command is too large for the connected device.',
      PROJECT_CHANGED: 'The iCreator project changed. Reconnect the device.'
    };
    return known[code] || message;
  }

  function getCommands() {
    return {
      start: ui.cmdStart.value.trim(),
      up: ui.cmdUp.value.trim(),
      down: ui.cmdDown.value.trim(),
      stop: ui.cmdStop.value.trim()
    };
  }

  async function saveCommands() {
    if (!sdk) return;
    const commands = getCommands();
    if (Object.values(commands).some((v) => !v)) {
      log('Commands cannot be empty.', 'err');
      return;
    }
    await sdk.storage.set('commands', commands);
    log('Command settings saved.', 'ok');
  }

  async function loadSettings() {
    if (!sdk) return;
    try {
      const commands = await sdk.storage.get('commands');
      if (commands && typeof commands === 'object') {
        ui.cmdStart.value = commands.start || DEFAULTS.start;
        ui.cmdUp.value = commands.up || DEFAULTS.up;
        ui.cmdDown.value = commands.down || DEFAULTS.down;
        ui.cmdStop.value = commands.stop || DEFAULTS.stop;
      }
      const best = await sdk.storage.get('bestScore');
      game.best = Number.isFinite(best) ? best : 0;
      ui.best.textContent = String(game.best);
    } catch (error) {
      log('Could not load saved settings: ' + niceError(error), 'err');
    }
  }

  function updateDeviceUi(state) {
    latestState = state;
    const device = state && state.currentDevice;
    const busy = !!(state && state.activity);

    if (device) {
      ui.deviceStatus.textContent = busy ? device.name + ' · Busy' : device.name + ' · Connected';
      ui.deviceStatus.className = 'status ' + (busy ? 'busy' : 'connected');
      ui.connectBtn.disabled = true;
      ui.disconnectBtn.disabled = false;
      ui.startBtn.disabled = busy;
    } else {
      ui.deviceStatus.textContent = 'Disconnected';
      ui.deviceStatus.className = 'status disconnected';
      ui.connectBtn.disabled = false;
      ui.disconnectBtn.disabled = true;
      ui.startBtn.disabled = true;
    }
  }

  async function connectDevice() {
    if (!sdk || !visible) return;
    try {
      log('Opening Bluetooth device chooser…');
      const state = await sdk.device.connect({ profileId: 'integem-crowbot-mqtt-v1' });
      updateDeviceUi(state);
      if (state.currentDevice) log('Connected to ' + state.currentDevice.name + '.', 'ok');
    } catch (error) {
      log(niceError(error), 'err');
    }
  }

  async function disconnectDevice() {
    if (!sdk || !latestState || !latestState.currentDevice || !visible) return;
    try {
      const target = latestState.currentDevice;
      await sdk.device.disconnect({
        deviceId: target.deviceId,
        connectionId: target.connectionId
      });
      log('Bluetooth disconnected.', 'ok');
    } catch (error) {
      log(niceError(error), 'err');
    }
  }

  async function sendCommand(text, label, throttleControl = false) {
    if (!sdk || !visible) {
      log(label + ': module is not active.', 'err');
      return false;
    }

    if (!text) {
      log(label + ': command is empty.', 'err');
      return false;
    }

    if (throttleControl) {
      const now = performance.now();
      if (now - lastControlSend < 120) {
        log(label + ': skipped to stay within BLE send rate.', 'muted');
        return false;
      }
      lastControlSend = now;
    }

    try {
      const state = await sdk.device.getState();
      latestState = state;
      const target = state.currentDevice;
      if (!target) {
        log(label + ': no Bluetooth device connected.', 'err');
        return false;
      }
      if (state.activity) {
        log(label + ': device busy, command not replayed.', 'err');
        return false;
      }
      await sdk.device.send({
        deviceId: target.deviceId,
        connectionId: target.connectionId,
        text
      });
      log(label + ' → ' + text, 'ok');
      return true;
    } catch (error) {
      log(label + ': ' + niceError(error), 'err');
      return false;
    }
  }

  function resetGame() {
    game.score = 0;
    game.spawnTimer = 0;
    game.stopSent = false;
    game.bird.x = 180;
    game.bird.y = canvas.height * 0.48;
    game.bird.vy = 0;
    game.pipes = [];
    game.particles = [];
    ui.score.textContent = '0';
  }

  async function startGame() {
    if (game.mode === 'running') return;
    if (!latestState || !latestState.currentDevice) {
      log('Connect Bluetooth before starting.', 'err');
      return;
    }

    const commands = getCommands();
    const sent = await sendCommand(commands.start, 'START');
    if (!sent) return;

    resetGame();
    game.mode = 'running';
    game.lastFrame = performance.now();
    ui.overlay.classList.add('hidden');
  }

  function spawnPipe() {
    const gap = 150;
    const margin = 78;
    const minCenter = margin + gap / 2;
    const maxCenter = canvas.height - margin - gap / 2;
    const center = minCenter + Math.random() * (maxCenter - minCenter);
    game.pipes.push({
      x: canvas.width + 40,
      width: 70,
      top: center - gap / 2,
      bottom: center + gap / 2,
      scored: false
    });
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
      circleRectCollision(b.x, b.y, b.r, p.x, p.bottom, p.width, canvas.height - p.bottom)
    );
  }

  async function gameOver() {
    if (game.mode !== 'running') return;
    game.mode = 'over';
    addBurst(game.bird.x, game.bird.y);

    if (game.score > game.best) {
      game.best = game.score;
      ui.best.textContent = String(game.best);
      if (sdk) {
        try { await sdk.storage.set('bestScore', game.best); } catch (_) {}
      }
    }

    ui.overlayTitle.textContent = 'Game Over';
    ui.overlayText.textContent = 'Score: ' + game.score + ' · Best: ' + game.best;
    ui.startBtn.textContent = 'Play Again';
    ui.overlay.classList.remove('hidden');

    if (!game.stopSent) {
      game.stopSent = true;
      await sendCommand(getCommands().stop, 'STOP');
    }
  }

  function update(dt) {
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
        ui.score.textContent = String(game.score);
      }
    }
    game.pipes = game.pipes.filter((p) => p.x + p.width > -20);

    for (const particle of game.particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += 500 * dt;
      particle.life -= dt;
    }
    game.particles = game.particles.filter((p) => p.life > 0);

    if (isCollision()) void gameOver();
  }

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, '#76d7ff');
    sky.addColorStop(1, '#d9f6ff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(255,255,255,.55)';
    for (let i = 0; i < 5; i += 1) {
      const x = ((i * 220 + performance.now() * 0.01) % 1100) - 100;
      const y = 80 + (i % 3) * 55;
      ctx.beginPath();
      ctx.arc(x, y, 26, 0, Math.PI * 2);
      ctx.arc(x + 28, y + 5, 20, 0, Math.PI * 2);
      ctx.arc(x - 26, y + 7, 18, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#5ab65c';
    ctx.fillRect(0, canvas.height - 26, canvas.width, 26);
    ctx.fillStyle = '#3a8d45';
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
    const dt = Math.min(0.035, (now - (game.lastFrame || now)) / 1000);
    game.lastFrame = now;
    if (visible) update(dt);
    render();
    requestAnimationFrame(frame);
  }

  function controlUp() {
    if (game.mode !== 'running') return;
    game.bird.vy = -430;
    void sendCommand(getCommands().up, 'UP', true);
  }

  function controlDown() {
    if (game.mode !== 'running') return;
    game.bird.vy = Math.max(game.bird.vy + 360, 340);
    void sendCommand(getCommands().down, 'DOWN', true);
  }

  function bindEvents() {
    ui.connectBtn.addEventListener('click', () => void connectDevice());
    ui.disconnectBtn.addEventListener('click', () => void disconnectDevice());
    ui.startBtn.addEventListener('click', () => void startGame());
    ui.upBtn.addEventListener('click', controlUp);
    ui.downBtn.addEventListener('click', controlDown);
    ui.saveBtn.addEventListener('click', () => void saveCommands());
    ui.clearLogBtn.addEventListener('click', () => { ui.commandLog.innerHTML = ''; });

    window.addEventListener('keydown', (event) => {
      if (event.repeat) return;
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        controlUp();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        controlDown();
      }
    });
  }

  async function init() {
    bindEvents();
    render();

    if (!window.icreator) {
      ui.sdkWarning.classList.remove('hidden');
      ui.connectBtn.disabled = true;
      ui.startBtn.disabled = true;
      log('Open this module in iCreator.', 'err');
      requestAnimationFrame(frame);
      return;
    }

    sdk = window.icreator;

    try {
      sdkContext = await sdk.ready();
      log('iCreator SDK ' + sdkContext.apiVersion + ' ready.', 'ok');
      await loadSettings();

      offState = await sdk.device.watchState((state) => updateDeviceUi(state));

      offVisibility = sdk.lifecycle.onVisibilityChange((isVisible) => {
        visible = isVisible;
      });

      offDispose = sdk.lifecycle.onDispose(() => {
        if (offState) offState();
        if (offVisibility) offVisibility();
      });

      const state = await sdk.device.getState();
      updateDeviceUi(state);
    } catch (error) {
      ui.sdkWarning.classList.remove('hidden');
      ui.sdkWarning.textContent = niceError(error);
      log('SDK initialization failed: ' + niceError(error), 'err');
    }

    requestAnimationFrame(frame);
  }

  void init();
})();