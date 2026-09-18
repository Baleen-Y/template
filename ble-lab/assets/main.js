(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const ui = {
    modeBadge: $("modeBadge"),
    footerMode: $("footerMode"),
    languageBtn: $("languageBtn"),
    demoBtn: $("demoBtn"),
    sdkNotice: $("sdkNotice"),
    projectName: $("projectName"),
    moduleVersion: $("moduleVersion"),
    apiVersion: $("apiVersion"),
    platform: $("platform"),
    connectionBadge: $("connectionBadge"),
    deviceName: $("deviceName"),
    deviceStatus: $("deviceStatus"),
    connectionId: $("connectionId"),
    activity: $("activity"),
    activeGatt: $("activeGatt"),
    serviceUuid: $("serviceUuid"),
    writeUuid: $("writeUuid"),
    notifyUuid: $("notifyUuid"),
    readUuid: $("readUuid"),
    namePrefix: $("namePrefix"),
    writeMode: $("writeMode"),
    maxWriteBytes: $("maxWriteBytes"),
    connectBtn: $("connectBtn"),
    disconnectBtn: $("disconnectBtn"),
    connectionError: $("connectionError"),
    sendMode: $("sendMode"),
    sendSuffix: $("sendSuffix"),
    sendInput: $("sendInput"),
    sendBtn: $("sendBtn"),
    sendError: $("sendError"),
    lastSent: $("lastSent"),
    readBtn: $("readBtn"),
    pauseBtn: $("pauseBtn"),
    clearReceiveBtn: $("clearReceiveBtn"),
    receiveLog: $("receiveLog"),
    receiveError: $("receiveError"),
    packetInput: $("packetInput"),
    intervalMs: $("intervalMs"),
    packetCount: $("packetCount"),
    packetBytes: $("packetBytes"),
    uploadProgress: $("uploadProgress"),
    uploadStatus: $("uploadStatus"),
    uploadJob: $("uploadJob"),
    uploadBtn: $("uploadBtn"),
    cancelUploadBtn: $("cancelUploadBtn"),
    uploadError: $("uploadError")
  };

  const translations = {
    en: {
      sharedState: "Shared Device State",
      connectedGatt: "Connected GATT configuration",
      connection: "Connection",
      uuidHint: "Enter the UUIDs from your actual hardware specification. Unknown UUIDs are intentionally not prefilled.",
      send: "Send",
      receive: "Receive",
      receiveHint: "Notifications are raw byte events. UTF-8 text is shown only as a convenience view.",
      transfer: "Packet Transfer",
      packetHint: "One HEX packet per line. Completion means transport finished, not that the device executed the data.",
      cancelWarning: "Canceling an upload disconnects the shared device to stop queued writes."
    },
    zh: {
      sharedState: "共享设备状态",
      connectedGatt: "当前连接的 GATT 配置",
      connection: "连接",
      uuidHint: "请输入实际硬件文档中的 UUID。示例不会预填未知或虚构 UUID。",
      send: "发送",
      receive: "接收",
      receiveHint: "通知内容按原始字节显示；UTF-8 仅作为辅助文本视图。",
      transfer: "数据包传输",
      packetHint: "每行一个 HEX 数据包。完成仅表示传输结束，不表示设备已成功执行。",
      cancelWarning: "取消上传会断开共享设备，以停止尚未发送的队列数据。"
    }
  };

  let sdk = null;
  let context = null;
  let mode = "live";
  let language = "en";
  let realState = null;
  let demoState = makeDisconnectedState();
  let offState = null;
  let offData = null;
  let offUpload = null;
  let activeUploadJobId = null;
  let receiveEntries = [];
  let pauseAutoscroll = false;
  let disposed = false;

  function makeDisconnectedState() {
    return {
      projectSessionId: "demo-session",
      revision: 0,
      status: "disconnected",
      currentDevice: null,
      activity: null
    };
  }

  function activeState() {
    return mode === "demo" ? demoState : realState;
  }

  function setText(el, text) {
    el.textContent = text == null || text === "" ? "—" : String(text);
  }

  function friendlyError(error) {
    const code = error && error.code ? error.code : "";
    const raw = error && error.message ? error.message : String(error || "Unknown error");
    const known = {
      USER_CANCELED: "Device selection was canceled. You can try again.",
      UNSUPPORTED: "This operation is not supported in the current environment.",
      NOT_CONNECTED: "No compatible shared device is connected.",
      STALE_CONNECTION: "The connection changed. Please use the current device state and retry manually.",
      BUSY: "The shared device is busy with another operation.",
      PERMISSION_DENIED: "The module does not have permission for this operation.",
      PAYLOAD_TOO_LARGE: "The payload exceeds the allowed size.",
      PROJECT_CHANGED: "The project session changed. Reopen the module before continuing."
    };
    return known[code] || (code ? code + ": " + raw : raw);
  }

  function isGenericConnected(state) {
    return !!(
      state &&
      state.currentDevice &&
      state.currentDevice.profileId === "generic-ble-v1" &&
      state.currentDevice.gatt &&
      state.currentDevice.gatt.serviceUuid
    );
  }

  function currentTarget() {
    const state = activeState();
    if (!state || !state.currentDevice) return null;
    return {
      deviceId: state.currentDevice.deviceId,
      connectionId: state.currentDevice.connectionId
    };
  }

  function getActiveMaxWriteBytes() {
    const state = activeState();
    const value = state && state.currentDevice && state.currentDevice.gatt
      ? Number(state.currentDevice.gatt.maxWriteBytes || 20)
      : 20;
    return Number.isFinite(value) ? value : 20;
  }

  function renderState() {
    const state = activeState();
    const connected = !!(state && state.currentDevice);
    const generic = isGenericConnected(state);

    ui.connectionBadge.textContent = connected ? "CONNECTED" : "DISCONNECTED";
    ui.connectionBadge.className = "badge " + (connected ? "connected" : "neutral");

    setText(ui.deviceName, connected ? state.currentDevice.name : "—");
    setText(ui.deviceStatus, state ? state.status : "—");
    setText(ui.connectionId, connected ? state.currentDevice.connectionId : "—");

    if (state && state.activity) {
      const owner = state.activity.owner
        ? state.activity.owner.type + ":" + state.activity.owner.id
        : "unknown";
      setText(ui.activity, state.activity.kind + " · " + owner);
    } else {
      setText(ui.activity, "Idle");
    }

    if (connected && state.currentDevice.gatt) {
      ui.activeGatt.textContent = JSON.stringify(state.currentDevice.gatt, null, 2);
    } else if (connected) {
      ui.activeGatt.textContent =
        "Connected shared device uses a legacy/non-generic profile. Generic BLE operations are disabled. Disconnect explicitly before changing configuration.";
    } else {
      ui.activeGatt.textContent = "No active generic GATT configuration.";
    }

    const busy = !!(state && state.activity);
    const hasSdk = !!sdk;
    const canHardware = mode === "demo" || hasSdk;
    ui.connectBtn.disabled = !canHardware || busy || connected || !validateConnectionForm(false);
    ui.disconnectBtn.disabled = !canHardware || busy || !connected;
    ui.sendBtn.disabled = !canHardware || busy || !generic;
    ui.readBtn.disabled =
      !canHardware ||
      busy ||
      !generic ||
      !(state.currentDevice.gatt && state.currentDevice.gatt.readCharacteristicUuid);
    ui.uploadBtn.disabled = !canHardware || busy || !generic || !!activeUploadJobId;
    ui.cancelUploadBtn.disabled = mode === "demo" ? !activeUploadJobId : !activeUploadJobId;

    if (!generic && connected) {
      ui.connectionError.textContent =
        "A shared legacy/non-generic connection is active. Disconnect it explicitly before using BLE Lab generic operations.";
    } else if (!ui.connectionError.dataset.manual) {
      ui.connectionError.textContent = "";
    }
  }

  function renderMode() {
    const demo = mode === "demo";
    ui.modeBadge.textContent = demo ? "SIMULATED" : "LIVE";
    ui.modeBadge.className = "badge " + (demo ? "demo" : "live");
    ui.footerMode.textContent = demo ? "SIMULATED" : "LIVE";
    ui.demoBtn.textContent = demo ? "Exit Demo" : "Enter Demo";
    if (demo) {
      ui.sdkNotice.textContent = "Demo mode: all connection, send, receive, and transfer behavior is simulated locally. No hardware SDK methods are called.";
      ui.sdkNotice.classList.remove("hidden");
    } else if (!sdk) {
      ui.sdkNotice.textContent = 'Open this module in iCreator to use LIVE mode. You may enter Demo explicitly for simulated UI testing.';
      ui.sdkNotice.classList.remove("hidden");
    } else {
      ui.sdkNotice.classList.add("hidden");
    }
    renderState();
  }

  function applyLanguage() {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    ui.languageBtn.textContent = language === "en" ? "中文" : "English";
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (translations[language][key]) el.textContent = translations[language][key];
    });
  }

  function normalizeUuid(value) {
    return value.trim().toLowerCase();
  }

  function looksLikeFullUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  function validateConnectionForm(showError = true) {
    const service = normalizeUuid(ui.serviceUuid.value);
    const optional = [
      normalizeUuid(ui.writeUuid.value),
      normalizeUuid(ui.notifyUuid.value),
      normalizeUuid(ui.readUuid.value)
    ].filter(Boolean);
    const maxWriteBytes = Number(ui.maxWriteBytes.value);

    let message = "";
    if (!looksLikeFullUuid(service)) {
      message = "Service UUID must be a full 128-bit UUID.";
    } else if (!optional.length) {
      message = "Configure at least one write, notify, or read characteristic UUID.";
    } else if (optional.some((value) => !looksLikeFullUuid(value))) {
      message = "Configured characteristic UUIDs must be full 128-bit UUIDs.";
    } else if (!Number.isInteger(maxWriteBytes) || maxWriteBytes < 1 || maxWriteBytes > 512) {
      message = "maxWriteBytes must be an integer from 1 to 512.";
    }

    if (showError) {
      ui.connectionError.dataset.manual = message ? "1" : "";
      ui.connectionError.textContent = message;
    }
    return !message;
  }

  function connectionConfig() {
    const gatt = {
      serviceUuid: normalizeUuid(ui.serviceUuid.value),
      writeMode: ui.writeMode.value,
      maxWriteBytes: Number(ui.maxWriteBytes.value)
    };
    const write = normalizeUuid(ui.writeUuid.value);
    const notify = normalizeUuid(ui.notifyUuid.value);
    const read = normalizeUuid(ui.readUuid.value);
    const namePrefix = ui.namePrefix.value.trim();
    if (write) gatt.writeCharacteristicUuid = write;
    if (notify) gatt.notifyCharacteristicUuid = notify;
    if (read) gatt.readCharacteristicUuid = read;
    if (namePrefix) gatt.namePrefix = namePrefix;
    return gatt;
  }

  function utf8Bytes(text) {
    return Array.from(new TextEncoder().encode(text));
  }

  function bytesToHex(bytes) {
    return bytes.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
  }

  function bytesToText(bytes) {
    return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
  }

  function parseHex(text) {
    const compact = text.replace(/\s+/g, "");
    if (!compact) return [];
    if (/[^0-9a-f]/i.test(compact)) throw new Error("HEX contains invalid characters.");
    if (compact.length % 2 !== 0) throw new Error("HEX must contain an even number of digits.");
    const bytes = [];
    for (let i = 0; i < compact.length; i += 2) {
      bytes.push(parseInt(compact.slice(i, i + 2), 16));
    }
    return bytes;
  }

  function buildSendPayload() {
    const modeValue = ui.sendMode.value;
    const suffix = ui.sendSuffix.value;
    let bytes;
    let text = null;

    if (modeValue === "hex") {
      bytes = parseHex(ui.sendInput.value);
      if (suffix === "lf") bytes.push(0x0a);
      if (suffix === "crlf") bytes.push(0x0d, 0x0a);
      return { data: bytes, bytes };
    }

    text = ui.sendInput.value;
    if (suffix === "lf") text += "\n";
    if (suffix === "crlf") text += "\r\n";
    bytes = utf8Bytes(text);
    return { text, bytes };
  }

  function validateLength(bytes) {
    const max = getActiveMaxWriteBytes();
    if (!bytes.length) throw new Error("Payload is empty.");
    if (bytes.length > max) {
      throw new Error("Payload is " + bytes.length + " bytes; active maxWriteBytes is " + max + ". BLE Lab does not split manual sends automatically.");
    }
  }

  function addReceiveEntry(entry, simulated = false) {
    receiveEntries.push({ ...entry, simulated });
    if (receiveEntries.length > 500) receiveEntries = receiveEntries.slice(-500);
    renderReceiveLog();
  }

  function renderReceiveLog() {
    ui.receiveLog.replaceChildren();
    receiveEntries.forEach((entry) => {
      const wrap = document.createElement("div");
      wrap.className = "log-entry";

      const meta = document.createElement("div");
      meta.className = "log-meta";
      meta.textContent =
        new Date(entry.timestamp).toLocaleTimeString() +
        " · " +
        (entry.simulated ? "SIMULATED · " : "") +
        "connection=" +
        (entry.connectionId || "—");

      const hex = document.createElement("div");
      hex.className = "log-hex";
      hex.textContent = "HEX  " + bytesToHex(entry.data || []);

      const textView = document.createElement("div");
      textView.className = "log-text";
      textView.textContent = "UTF8 " + (entry.text != null ? entry.text : bytesToText(entry.data || []));

      wrap.append(meta, hex, textView);
      ui.receiveLog.appendChild(wrap);
    });
    if (!pauseAutoscroll) ui.receiveLog.scrollTop = ui.receiveLog.scrollHeight;
  }

  function parsePacketLines(showError = false) {
    const lines = ui.packetInput.value.split(/\r?\n/);
    const packets = [];
    let total = 0;
    let error = "";
    try {
      lines.forEach((line, index) => {
        if (!line.trim()) return;
        const packet = parseHex(line);
        if (!packet.length) return;
        const max = getActiveMaxWriteBytes();
        if (packet.length > max) {
          throw new Error("Line " + (index + 1) + " is " + packet.length + " bytes; active maxWriteBytes is " + max + ".");
        }
        packets.push(packet);
        total += packet.length;
      });
      if (packets.length > 8192) throw new Error("Maximum packet count is 8192.");
      if (total > 128 * 1024) throw new Error("Total packet bytes exceed 128 KiB.");
      const interval = Number(ui.intervalMs.value);
      if (!Number.isInteger(interval) || interval < 0 || interval > 1000) {
        throw new Error("intervalMs must be an integer from 0 to 1000.");
      }
    } catch (e) {
      error = e.message;
    }
    ui.packetCount.textContent = String(packets.length);
    ui.packetBytes.textContent = String(total);
    if (showError) ui.uploadError.textContent = error;
    return error ? null : packets;
  }

  async function saveSettings() {
    if (!sdk || mode !== "live") return;
    try {
      await sdk.storage.set("settings", {
        gatt: {
          serviceUuid: ui.serviceUuid.value,
          writeUuid: ui.writeUuid.value,
          notifyUuid: ui.notifyUuid.value,
          readUuid: ui.readUuid.value,
          namePrefix: ui.namePrefix.value,
          writeMode: ui.writeMode.value,
          maxWriteBytes: Number(ui.maxWriteBytes.value)
        },
        intervalMs: Number(ui.intervalMs.value),
        language,
        sendMode: ui.sendMode.value
      });
    } catch (e) {
      console.warn("Could not persist BLE Lab settings:", e);
    }
  }

  async function restoreSettings() {
    if (!sdk) return;
    try {
      const saved = await sdk.storage.get("settings");
      if (!saved) return;
      const g = saved.gatt || {};
      ui.serviceUuid.value = g.serviceUuid || "";
      ui.writeUuid.value = g.writeUuid || "";
      ui.notifyUuid.value = g.notifyUuid || "";
      ui.readUuid.value = g.readUuid || "";
      ui.namePrefix.value = g.namePrefix || "";
      ui.writeMode.value = g.writeMode || "with-response";
      ui.maxWriteBytes.value = String(g.maxWriteBytes || 20);
      ui.intervalMs.value = String(saved.intervalMs ?? 20);
      ui.sendMode.value = saved.sendMode || "text";
      language = saved.language === "zh" ? "zh" : "en";
      applyLanguage();
      parsePacketLines(false);
    } catch (e) {
      console.warn("Could not restore BLE Lab settings:", e);
    }
  }

  async function connect() {
    ui.connectionError.dataset.manual = "";
    ui.connectionError.textContent = "";
    if (!validateConnectionForm(true)) return;
    await saveSettings();

    if (mode === "demo") {
      demoState = {
        projectSessionId: "demo-session",
        revision: demoState.revision + 1,
        status: "connected",
        currentDevice: {
          deviceId: "demo-device",
          connectionId: "demo-" + Date.now(),
          name: ui.namePrefix.value.trim() || "Simulated BLE Device",
          profileId: "generic-ble-v1",
          gatt: connectionConfig()
        },
        activity: null
      };
      renderState();
      return;
    }

    if (!sdk) return;
    try {
      await sdk.device.connect({
        profileId: "generic-ble-v1",
        gatt: connectionConfig()
      });
    } catch (e) {
      ui.connectionError.dataset.manual = "1";
      ui.connectionError.textContent = friendlyError(e);
    }
  }

  async function disconnect() {
    ui.connectionError.dataset.manual = "";
    ui.connectionError.textContent = "";

    if (mode === "demo") {
      demoState = makeDisconnectedState();
      renderState();
      return;
    }

    const target = currentTarget();
    if (!sdk || !target) return;
    try {
      await sdk.device.disconnect(target);
    } catch (e) {
      ui.connectionError.dataset.manual = "1";
      ui.connectionError.textContent = friendlyError(e);
    }
  }

  async function sendPayload() {
    ui.sendError.textContent = "";
    const target = currentTarget();
    if (!target) {
      ui.sendError.textContent = "No compatible device is connected.";
      return;
    }
    try {
      const payload = buildSendPayload();
      validateLength(payload.bytes);
      const timestamp = Date.now();

      if (mode === "demo") {
        ui.lastSent.textContent = new Date(timestamp).toLocaleTimeString() + " · " + bytesToHex(payload.bytes);
        setTimeout(() => {
          if (mode !== "demo") return;
          addReceiveEntry({
            timestamp: Date.now(),
            connectionId: demoState.currentDevice ? demoState.currentDevice.connectionId : "demo",
            data: payload.bytes,
            text: bytesToText(payload.bytes)
          }, true);
        }, 80);
        return;
      }

      if (!sdk) return;
      const request = { ...target };
      if (Object.prototype.hasOwnProperty.call(payload, "text")) request.text = payload.text;
      else request.data = payload.data;
      await sdk.device.send(request);
      ui.lastSent.textContent = new Date(timestamp).toLocaleTimeString() + " · " + bytesToHex(payload.bytes);
    } catch (e) {
      ui.sendError.textContent = friendlyError(e);
    }
  }

  async function readDevice() {
    ui.receiveError.textContent = "";
    const target = currentTarget();
    if (!target) return;
    try {
      if (mode === "demo") {
        const bytes = utf8Bytes("demo-read");
        addReceiveEntry({
          timestamp: Date.now(),
          connectionId: target.connectionId,
          data: bytes,
          text: "demo-read"
        }, true);
        return;
      }
      if (!sdk) return;
      const reading = await sdk.device.read(target);
      addReceiveEntry({
        timestamp: reading.timestamp,
        connectionId: reading.connectionId,
        data: reading.data || [],
        text: reading.text || ""
      });
    } catch (e) {
      ui.receiveError.textContent = friendlyError(e);
    }
  }

  function makeClientRequestId() {
    return "blelab_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
  }

  async function startUpload() {
    ui.uploadError.textContent = "";
    const packets = parsePacketLines(true);
    if (!packets || !packets.length) {
      if (!ui.uploadError.textContent) ui.uploadError.textContent = "Add at least one nonempty HEX packet.";
      return;
    }
    const target = currentTarget();
    if (!target) {
      ui.uploadError.textContent = "No compatible device is connected.";
      return;
    }
    const intervalMs = Number(ui.intervalMs.value);
    await saveSettings();

    if (mode === "demo") {
      activeUploadJobId = "demo-upload-" + Date.now();
      ui.uploadJob.textContent = activeUploadJobId;
      ui.uploadStatus.textContent = "sending (simulated)";
      ui.uploadProgress.value = 0;
      renderState();

      let index = 0;
      const timer = setInterval(() => {
        if (!activeUploadJobId || mode !== "demo") {
          clearInterval(timer);
          return;
        }
        index += 1;
        ui.uploadProgress.value = Math.round((index / packets.length) * 100);
        if (index >= packets.length) {
          clearInterval(timer);
          ui.uploadProgress.value = 100;
          ui.uploadStatus.textContent = "Sent — unconfirmed (simulated)";
          activeUploadJobId = null;
          renderState();
        }
      }, Math.max(25, intervalMs));
      return;
    }

    if (!sdk) return;
    try {
      const accepted = await sdk.device.upload({
        ...target,
        profileId: "generic-ble-v1",
        clientRequestId: makeClientRequestId(),
        artifact: {
          kind: "ble-packets",
          packets,
          intervalMs
        }
      });
      activeUploadJobId = accepted.jobId;
      ui.uploadJob.textContent = accepted.jobId;
      ui.uploadStatus.textContent = "queued";
      ui.uploadProgress.value = 0;
      renderState();

      offUpload = await sdk.device.watchUpload(accepted.jobId, (snapshot) => {
        ui.uploadStatus.textContent = snapshot.phase || "running";
        ui.uploadProgress.value = Math.round(Number(snapshot.progress || 0) * (Number(snapshot.progress || 0) <= 1 ? 100 : 1));
        if (snapshot.error) ui.uploadError.textContent = snapshot.error.message || String(snapshot.error);
      });

      const result = await sdk.device.waitForUpload(accepted.jobId);
      ui.uploadProgress.value = 100;
      ui.uploadStatus.textContent = result && result.confirmation === "sent-unconfirmed"
        ? "Sent — unconfirmed"
        : "Sent — unconfirmed";
    } catch (e) {
      ui.uploadError.textContent = friendlyError(e);
      ui.uploadStatus.textContent = "failed";
    } finally {
      if (offUpload) {
        try { offUpload(); } catch (_) {}
        offUpload = null;
      }
      activeUploadJobId = null;
      renderState();
    }
  }

  async function cancelUpload() {
    ui.uploadError.textContent = "";
    if (!activeUploadJobId) return;

    if (mode === "demo") {
      activeUploadJobId = null;
      demoState = makeDisconnectedState();
      ui.uploadStatus.textContent = "canceled (simulated); device disconnected";
      ui.uploadProgress.value = 0;
      renderState();
      return;
    }

    if (!sdk) return;
    try {
      await sdk.device.cancelUpload(activeUploadJobId);
      ui.uploadStatus.textContent = "canceled; shared device disconnect requested";
    } catch (e) {
      ui.uploadError.textContent = friendlyError(e);
    }
  }

  async function toggleDemo() {
    if (mode === "demo") {
      mode = "live";
      demoState = makeDisconnectedState();
      receiveEntries = receiveEntries.filter((item) => !item.simulated);
      if (sdk) {
        try { realState = await sdk.device.getState(); } catch (_) {}
      }
    } else {
      mode = "demo";
      demoState = makeDisconnectedState();
    }
    renderMode();
    renderReceiveLog();
  }

  function bindEvents() {
    ui.languageBtn.addEventListener("click", async () => {
      language = language === "en" ? "zh" : "en";
      applyLanguage();
      await saveSettings();
    });
    ui.demoBtn.addEventListener("click", toggleDemo);
    ui.connectBtn.addEventListener("click", connect);
    ui.disconnectBtn.addEventListener("click", disconnect);
    ui.sendBtn.addEventListener("click", sendPayload);
    ui.readBtn.addEventListener("click", readDevice);
    ui.clearReceiveBtn.addEventListener("click", () => {
      receiveEntries = [];
      renderReceiveLog();
    });
    ui.pauseBtn.addEventListener("click", () => {
      pauseAutoscroll = !pauseAutoscroll;
      ui.pauseBtn.textContent = pauseAutoscroll ? "Resume autoscroll" : "Pause autoscroll";
      if (!pauseAutoscroll) ui.receiveLog.scrollTop = ui.receiveLog.scrollHeight;
    });
    ui.packetInput.addEventListener("input", () => parsePacketLines(false));
    ui.intervalMs.addEventListener("input", () => parsePacketLines(false));
    ui.uploadBtn.addEventListener("click", startUpload);
    ui.cancelUploadBtn.addEventListener("click", cancelUpload);

    [
      ui.serviceUuid, ui.writeUuid, ui.notifyUuid, ui.readUuid,
      ui.namePrefix, ui.writeMode, ui.maxWriteBytes
    ].forEach((el) => {
      el.addEventListener("input", () => {
        validateConnectionForm(false);
        renderState();
      });
      el.addEventListener("change", saveSettings);
    });
    ui.sendMode.addEventListener("change", saveSettings);
    ui.intervalMs.addEventListener("change", saveSettings);
  }

  async function initSdk() {
    if (!window.icreator) {
      sdk = null;
      context = null;
      renderMode();
      return;
    }

    sdk = window.icreator;
    try {
      context = await sdk.ready();
      setText(ui.projectName, context.project && context.project.name);
      setText(ui.moduleVersion, (context.module && context.module.id ? context.module.id : "ble-lab") + " " + (context.module && context.module.version ? context.module.version : "1.0.0"));
      setText(ui.apiVersion, context.apiVersion);
      setText(ui.platform, context.platform);

      await restoreSettings();

      offState = await sdk.device.watchState((state) => {
        realState = state;
        if (mode === "live") renderState();
      });
      offData = await sdk.device.onData((event) => {
        if (mode !== "live") return;
        addReceiveEntry({
          timestamp: event.timestamp,
          connectionId: event.connectionId,
          data: event.data || [],
          text: event.text || ""
        }, false);
      });

      try {
        realState = await sdk.device.getState();
      } catch (_) {}
      renderMode();

      if (sdk.lifecycle && sdk.lifecycle.onVisibilityChange) {
        sdk.lifecycle.onVisibilityChange((visible) => {
          if (!visible) {
            // BLE Lab has no recurring live polling. Accepted host upload tasks may continue.
          }
        });
      }
      if (sdk.lifecycle && sdk.lifecycle.onDispose) {
        sdk.lifecycle.onDispose(() => {
          disposed = true;
          if (offState) offState();
          if (offData) offData();
          if (offUpload) offUpload();
          // Intentionally do not disconnect the shared device.
        });
      }
    } catch (e) {
      sdk = null;
      ui.sdkNotice.textContent = "Could not initialize iCreator SDK: " + friendlyError(e);
      ui.sdkNotice.classList.remove("hidden");
      renderMode();
    }
  }

  bindEvents();
  applyLanguage();
  parsePacketLines(false);
  renderMode();
  initSdk().catch((e) => {
    if (!disposed) {
      ui.sdkNotice.textContent = "Initialization failed: " + friendlyError(e);
      ui.sdkNotice.classList.remove("hidden");
    }
  });
})();
