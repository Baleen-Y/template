import { PROFILE, Snapshot, byteLength, clone } from './model.js';
export interface Target { deviceId: string; connectionId: string }
export interface Device extends Target { name: string; profileId: string }
export interface State {
  projectSessionId: string; revision: number; status: string; currentDevice: Device | null;
  activity: null | { kind: 'send' | 'read' | 'upload'; owner: { type: 'host' | 'module'; id: string }; jobId?: string };
}
export interface DataEvent extends Target { projectSessionId: string; sequence: number; timestamp: number; text: string; data: number[] }
export interface Context {
  apiVersion: string; platform: string; project: { sessionId: string };
  module: { id: string; instanceId: string }; grantedPermissions: string[];
  capabilities: { device: { available: boolean; unavailableReason?: string; profiles?: unknown[] } };
}
export type Off = () => void;
export interface SDK {
  ready(): Promise<Context>;
  storage: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
  device: {
    getState(): Promise<State>; watchState(fn: (s: State) => void): Promise<Off>; onData(fn: (d: DataEvent) => void): Promise<Off>;
    connect(config: { profileId: string }): Promise<State>; disconnect(target: Target): Promise<void>;
    send(request: Target & { text: string }): Promise<unknown>;
    upload(request: Target & { profileId: string; clientRequestId: string; artifact: { kind: 'micropython'; source: string; workspacePolicy: 'replace'; workspace: Snapshot } }): Promise<{ jobId: string }>;
    watchUpload(job: string, fn: (s: { phase?: string; status?: string; progress?: number }) => void): Promise<Off>;
    waitForUpload(job: string): Promise<{ confirmation?: string }>;
    cancelUpload(job: string): Promise<unknown>;
  };
  lifecycle: { onVisibilityChange(fn: (v: boolean) => void): Off | void; onDispose(fn: () => void): Off | void };
}
export const errorText = (e: unknown): string => {
  const x = e as { code?: string; message?: string } | null;
  return (x?.code ? x.code + ': ' : '') + (x?.message ?? String(e));
};
export function connectionKey(s: State | null): string {
  return s?.currentDevice ? JSON.stringify([s.projectSessionId, s.currentDevice.deviceId, s.currentDevice.connectionId]) : '';
}
export class ReadSession {
  readonly promise: Promise<{ raw: string; workspace: unknown; bytes: number }>;
  private resolve!: (value: { raw: string; workspace: unknown; bytes: number }) => void;
  private reject!: (error: Error) => void;
  private decoder = new TextDecoder('utf-8', { fatal: true });
  private timers: ReturnType<typeof setTimeout>[] = [];
  private idle?: ReturnType<typeof setTimeout>;
  private first?: ReturnType<typeof setTimeout>;
  private stack: string[] = []; private quoted = false; private escaped = false; private started = false;
  private scanned = 0; private count = 0; private lastSequence = -1;
  raw = ''; settled = false;
  constructor(readonly key: string, readonly target: Target, readonly session: string,
    private timeout = { first: 5000, idle: 5000, total: 60000, max: 256 * 1024 }) {
    this.promise = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    void this.promise.catch(() => undefined);
    this.first = setTimeout(() => this.abort('No workspace bytes arrived before the first-byte timeout.'), timeout.first);
    this.timers.push(this.first, setTimeout(() => this.abort('Workspace read reached its total timeout.'), timeout.total));
  }
  abort(message: string): void {
    if (this.settled) return;
    this.settled = true; this.cleanup(); this.reject(new Error(message));
  }
  private cleanup(): void { this.timers.forEach(clearTimeout); if (this.idle) clearTimeout(this.idle); }
  feed(e: DataEvent): void {
    if (this.settled || e.deviceId !== this.target.deviceId || e.connectionId !== this.target.connectionId || e.projectSessionId !== this.session) return;
    if (e.sequence <= this.lastSequence) return;
    this.lastSequence = e.sequence;
    if (!Array.isArray(e.data) || e.data.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return this.abort('Invalid notification bytes.');
    if (!e.data.length) return;
    if (this.first) clearTimeout(this.first);
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => this.abort('Workspace read reached its idle timeout.'), this.timeout.idle);
    if ((this.count += e.data.length) > this.timeout.max) return this.abort('Readback exceeds 256 KiB.');
    try {
      this.raw += this.decoder.decode(new Uint8Array(e.data), { stream: true });
      for (; this.scanned < this.raw.length; this.scanned++) {
        const c = this.raw[this.scanned];
        if (!this.started) {
          if (/\s/.test(c)) continue;
          if (c !== '{') throw new Error('Unexpected data before workspace JSON; unknown telemetry is not stripped.');
          this.started = true;
        }
        if (this.quoted) {
          if (this.escaped) this.escaped = false;
          else if (c === '\\') this.escaped = true;
          else if (c === '"') this.quoted = false;
        } else if (c === '"') this.quoted = true;
        else if (c === '{' || c === '[') this.stack.push(c);
        else if (c === '}' || c === ']') {
          const opened = this.stack.pop();
          if (opened !== (c === '}' ? '{' : '[')) throw new Error('Unbalanced JSON response.');
          if (!this.stack.length) {
            this.raw += this.decoder.decode();
            if (this.raw.slice(this.scanned + 1).trim()) throw new Error('Mixed telemetry after workspace JSON.');
            const workspace: unknown = JSON.parse(this.raw);
            if (!workspace || typeof workspace !== 'object' || !('blocks' in workspace)) throw new Error('Response is not a Blockly workspace.');
            this.settled = true; this.cleanup(); this.resolve({ raw: this.raw, workspace, bytes: this.count }); return;
          }
        }
      }
    } catch (e) { this.abort(errorText(e)); }
  }
}
/** One pending ordinary event; terminal STOP drops it, including a selected but not-yet-written event. */
export class EventPump {
  private pending: { text: string; epoch: number; done: (ok: boolean) => void } | null = null;
  private working: Promise<void> | null = null;
  private last = -Infinity; private epoch = 0; private terminal = true; private closed = false;
  private stopTask: Promise<boolean> | null = null;
  constructor(private write: (text: string) => Promise<void>, private onError: (e: unknown) => void, private interval = 150) {}
  get busy(): boolean { return !!this.working || !!this.pending; }
  async begin(): Promise<boolean> {
    if (this.busy) throw new Error('Wait for the previous STOP to finish.');
    this.closed = false; this.terminal = false; this.epoch++; this.stopTask = null;
    return this.enqueue('start');
  }
  event(text: string): Promise<boolean> { return !this.terminal && !this.closed ? this.enqueue(text) : Promise.resolve(false); }
  stop(): Promise<boolean> {
    if (this.stopTask) return this.stopTask;
    this.terminal = true; this.epoch++;
    return this.stopTask = this.enqueue('stop');
  }
  retryStop(): Promise<boolean> { this.stopTask = null; this.closed = false; return this.stop(); }
  cancel(): void { this.closed = true; this.terminal = true; this.epoch++; this.pending?.done(false); this.pending = null; }
  private enqueue(text: string): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    this.pending?.done(false);
    const promise = new Promise<boolean>(done => { this.pending = { text, epoch: this.epoch, done }; });
    if (!this.working) this.working = this.pump();
    return promise;
  }
  private async pump(): Promise<void> {
    await Promise.resolve();
    while (this.pending) {
      const item = this.pending; this.pending = null;
      const wait = Math.max(0, this.interval - (performance.now() - this.last));
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      if (this.closed || item.epoch !== this.epoch) { item.done(false); continue; }
      try { this.last = performance.now(); await this.write(item.text); item.done(true); }
      catch (e) { this.onError(e); item.done(false); }
    }
    this.working = null;
  }
}
export class Link {
  state: State | null = null; visible = true; disposed = false;
  operation = ''; job = ''; private reader: ReadSession | null = null;
  private unsubs: Off[] = []; private offJob: Off | null = null;
  constructor(readonly sdk: SDK, readonly context: Context, readonly changed: () => void,
    readonly diagnostic: (text: string) => void, readonly data: (e: DataEvent) => void) {}
  async init(): Promise<void> {
    const off = await this.sdk.device.watchState(s => {
      if (this.disposed) return;
      this.state = s;
      if (this.reader) {
        if (connectionKey(s) !== this.reader.key) this.reader.abort('Readback canceled: project or connection changed.');
        const a = s.activity;
        if (a && !(a.owner.type === 'module' && a.owner.id === this.context.module.id && a.kind === 'send')) this.reader.abort('Readback canceled: conflicting shared-device activity.');
      }
      this.changed();
    });
    if (this.disposed) off(); else this.unsubs.push(off);
    const offData = await this.sdk.device.onData(e => { if (!this.disposed) { this.reader?.feed(e); this.data(e); } });
    if (this.disposed) offData(); else this.unsubs.push(offData);
  }
  async current(expected?: string): Promise<{ state: State; target: Device }> {
    if (!this.visible || this.disposed) throw new Error('Module is hidden or closed; no device operation was started.');
    const state = await this.sdk.device.getState();
    if (!this.visible || this.disposed) throw new Error('Module became hidden or closed.');
    if (state.projectSessionId !== this.context.project.sessionId) throw new Error('PROJECT_CHANGED: reopen this module in the current project.');
    if (expected && connectionKey(state) !== expected) throw new Error('STALE_CONNECTION: the intended connection changed.');
    const target = state.currentDevice;
    if (!target) throw new Error('NOT_CONNECTED: connect your Crowbot first.');
    if (target.profileId !== PROFILE) throw new Error('This course requires the Crowbot compatibility firmware/profile.');
    if (state.activity) throw new Error('BUSY: the shared device is in use. No operation was replayed.');
    this.state = state;
    return { state, target };
  }
  private lock(name: string): void {
    if (this.operation) throw new Error(`Finish ${this.operation} first.`);
    this.operation = name; this.changed();
  }
  private unlock(): void { this.operation = ''; if (!this.disposed) this.changed(); }
  async connect(): Promise<void> {
    this.lock('connect');
    try {
      if (!this.visible || this.disposed) throw new Error('Open the module to connect.');
      await this.sdk.device.connect({ profileId: PROFILE });
    } finally { this.unlock(); }
  }
  async disconnect(): Promise<void> {
    this.lock('disconnect');
    try { const { target } = await this.current(); await this.sdk.device.disconnect({ deviceId: target.deviceId, connectionId: target.connectionId }); }
    finally { this.unlock(); }
  }
  async send(text: string, expected: string): Promise<void> {
    if (this.operation) throw new Error(`Device is reserved locally for ${this.operation}.`);
    const { target } = await this.current(expected);
    if (byteLength(text) > 512 || /^(b:|m:|json:|xml:|source:)/.test(text)) throw new Error('Invalid runtime message.');
    await this.sdk.device.send({ deviceId: target.deviceId, connectionId: target.connectionId, text });
    this.diagnostic(`Sent ${text} — device execution unconfirmed`);
  }
  async upload(snapshot: Snapshot, source: string, expected: string, onProgress: (label: string, percent: number) => void): Promise<string> {
    this.lock('upload');
    const frozen = clone(snapshot);
    try {
      const { target } = await this.current(expected);
      const created = await this.sdk.device.upload({ deviceId: target.deviceId, connectionId: target.connectionId,
        profileId: PROFILE, clientRequestId: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2,'0')).join(''),
        artifact: { kind: 'micropython', source, workspacePolicy: 'replace', workspace: frozen } });
      this.job = created.jobId; if (!this.disposed) this.changed();
      try {
        this.offJob = await this.sdk.device.watchUpload(this.job, s => {
          if (!this.disposed) onProgress(s.phase ?? s.status ?? 'Uploading', Math.min(100, Math.max(0, (s.progress ?? 0) * ((s.progress ?? 0) <= 1 ? 100 : 1))));
        });
      } catch (e) { this.diagnostic('Progress subscription failed: ' + errorText(e) + '; still awaiting the accepted job.'); }
      if (this.disposed) { this.offJob?.(); this.offJob = null; }
      const result = await this.sdk.device.waitForUpload(this.job);
      return result.confirmation ?? 'unconfirmed';
    } finally { this.offJob?.(); this.offJob = null; this.job = ''; this.unlock(); }
  }
  async cancelUpload(): Promise<void> {
    if (!this.job) throw new Error('No accepted upload to cancel.');
    await this.sdk.device.cancelUpload(this.job);
  }
  async read(): Promise<{ raw: string; workspace: unknown; bytes: number }> {
    this.lock('read');
    try {
      const { state, target } = await this.current();
      const reader = new ReadSession(connectionKey(state), target, state.projectSessionId);
      this.reader = reader;
      try {
        await this.sdk.device.send({ deviceId: target.deviceId, connectionId: target.connectionId, text: 'get_device_block_xml' });
        return await reader.promise;
      } catch (e) { reader.abort(errorText(e)); throw e; }
    } finally { this.reader = null; this.unlock(); }
  }
  cancelRead(): void { this.reader?.abort('Readback canceled by user.'); }
  setVisible(visible: boolean): void { this.visible = visible; if (!visible) this.reader?.abort('Readback canceled: module hidden.'); }
  dispose(): void {
    this.disposed = true; this.visible = false; this.reader?.abort('Module disposed.');
    this.offJob?.(); this.offJob = null; this.unsubs.splice(0).forEach(off => off());
    // Accepted uploads remain host-owned. Never disconnect shared BLE here.
  }
}
