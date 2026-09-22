import { stepWait } from './model.js';
import { runtimeCommand } from './runtime.js';
/** Cancellation before a write is distinguishable from an uncertain device failure. */
export class CanceledCommandError extends Error {
}
/** No command backlog. STOP invalidates any selected command still waiting for its rate slot. */
export class CommandGate {
    constructor(write, active, interval = 160) {
        this.write = write;
        this.active = active;
        this.interval = interval;
        this.flight = null;
        this.epoch = 0;
        this.last = -Infinity;
        this.pendingStop = null;
        this.wake = null;
        this.timer = null;
    }
    get busy() { return !!this.flight || !!this.pendingStop; }
    async delay(ms) { if (ms <= 0)
        return; await new Promise(resolve => { this.wake = resolve; this.timer = setTimeout(resolve, ms); }); if (this.timer)
        clearTimeout(this.timer); this.timer = null; this.wake = null; }
    async transmit(text, e) {
        await Promise.resolve();
        await this.delay(Math.max(0, this.interval - (performance.now() - this.last)));
        if (e !== this.epoch || !this.active())
            throw new CanceledCommandError('This command was canceled before sending.');
        this.last = performance.now();
        await this.write(text);
    }
    async send(text) {
        if (this.busy)
            throw new Error('One step at a time. The previous action has not finished.');
        const p = this.transmit(text, this.epoch);
        this.flight = p;
        try {
            await p;
        }
        finally {
            if (this.flight === p)
                this.flight = null;
        }
    }
    stop() {
        if (this.pendingStop)
            return this.pendingStop;
        this.epoch++;
        const e = this.epoch;
        this.wake?.();
        const old = this.flight;
        const task = (async () => {
            try {
                await old;
            }
            catch { /* An invalidated ordinary command is never replayed. */ }
            if (!this.active())
                return false;
            try {
                const p = this.transmit('stop', e);
                this.flight = p;
                await p;
                return true;
            }
            finally {
                this.flight = null;
            }
        })();
        this.pendingStop = task;
        void task.finally(() => { if (this.pendingStop === task)
            this.pendingStop = null; }).catch(() => undefined);
        return task;
    }
    cancel() { this.epoch++; this.wake?.(); }
}
export class DeliveryRun {
    constructor(artifact, gate, changed, active, timing = (a) => stepWait(a, artifact.program.tuning)) {
        this.artifact = artifact;
        this.gate = gate;
        this.changed = changed;
        this.active = active;
        this.timing = timing;
        this.mode = 'guided';
        this.phase = 'idle';
        this.confirmed = 0;
        this.runId = '';
        this.epoch = 0;
        this.timer = null;
        this.wake = null;
    }
    set(p) { this.phase = p; this.changed(); }
    async begin(runId) {
        if (this.phase !== 'idle')
            throw new Error('Start a fresh run from the launch page.');
        if (!/^[a-f0-9]{6}$/.test(runId))
            throw new Error('Invalid run identifier.');
        this.runId = runId;
        this.confirmed = 0;
        const e = ++this.epoch;
        this.set('arming');
        try {
            await this.gate.send(runtimeCommand(this.artifact.tag, 'a', runId));
            if (e === this.epoch && this.active())
                this.set('ready');
        }
        catch (err) {
            if (e === this.epoch)
                this.set('aborted');
            throw err;
        }
    }
    async step() {
        if (this.phase !== 'ready' || !this.active())
            throw new Error('Look at Bolt and confirm the previous step first.');
        const i = this.confirmed, e = this.epoch, step = this.artifact.program.steps[i];
        if (!step)
            throw new Error('No route step remains.');
        this.set('sending');
        try {
            await this.gate.send(runtimeCommand(this.artifact.tag, 's', this.runId, i));
            if (e !== this.epoch || !this.active())
                return;
            await new Promise(resolve => { this.wake = resolve; this.timer = setTimeout(resolve, this.timing(step.action)); });
            if (this.timer)
                clearTimeout(this.timer);
            this.timer = null;
            this.wake = null;
            // This is only a conservative UI wait. No step-execution acknowledgement exists.
            if (e === this.epoch && this.active())
                this.set('observe');
        }
        catch (err) {
            if (e === this.epoch)
                this.set('aborted');
            throw err;
        }
    }
    confirm() {
        if (this.phase !== 'observe' || !this.active())
            throw new Error('An observation is needed after a sent step.');
        this.confirmed++;
        this.set(this.confirmed === this.artifact.program.steps.length ? 'done' : 'ready');
    }
    cancel() { this.epoch++; if (this.timer)
        clearTimeout(this.timer); this.timer = null; this.wake?.(); this.wake = null; this.gate.cancel(); this.set('aborted'); }
    async stop() { this.cancel(); return this.gate.stop(); }
}
