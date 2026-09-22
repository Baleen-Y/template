import type { Action, Artifact } from './model.js';
import { stepWait } from './model.js';
import { CanceledCommandError, CommandGate } from './session.js';
import { runtimeCommand } from './runtime.js';

export type CruisePhase = 'idle' | 'arming' | 'cruising' | 'pausing' | 'paused'
  | 'finishing' | 'review' | 'done' | 'aborted';

/** A finite, explicitly started route. No sensor/step ACK is implied by pacing.
 * cursor counts estimated/paced steps; confirmed stays zero until the user
 * observes the whole delivery. No automatic retries or future-run replay.
 */
export class CruiseRun {
  readonly mode = 'cruise';
  phase: CruisePhase = 'idle';
  cursor = 0;
  confirmed = 0;
  runId = '';
  error = '';
  stopWritten = false;
  private nextIndex = 0;
  private epoch = 0;
  private pauseWanted = false;
  private loop: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wake: (() => void) | null = null;

  constructor(readonly artifact: Artifact, readonly gate: CommandGate,
    private changed: () => void, private active: () => boolean,
    private timing: (a: Action) => number = a => stepWait(a, artifact.program.tuning)) {}

  private set(p: CruisePhase): void { this.phase = p; this.changed(); }
  private alive(e: number): boolean { return e === this.epoch && this.active(); }
  private async delay(ms: number): Promise<void> {
    await new Promise<void>(resolve => { this.wake = resolve; this.timer = setTimeout(resolve, ms); });
    if (this.timer) clearTimeout(this.timer);
    this.timer = null; this.wake = null;
  }
  private fail(error: unknown, e: number): void {
    if (e !== this.epoch) return;
    this.error = error instanceof Error ? error.message : String(error);
    this.gate.cancel(); this.set('aborted');
  }

  async begin(nonce: string): Promise<void> {
    if (this.phase !== 'idle') throw new Error('Start a new cruise from robot setup.');
    await this.arm(nonce);
  }
  private async arm(nonce: string): Promise<void> {
    if (!this.active()) throw new Error('The current visible device session is unavailable.');
    if (!/^[a-f0-9]{6}$/.test(nonce) || nonce === this.runId) throw new Error('Use a fresh route nonce.');
    const e = ++this.epoch;
    this.runId = nonce; this.pauseWanted = false; this.stopWritten = false; this.set('arming');
    try {
      // New callback supports arming at the NEXT unsent step after a user resume.
      await this.gate.send(runtimeCommand(this.artifact.tag, 'a', nonce, this.nextIndex));
      if (!this.alive(e)) return;
      this.set('cruising');
      // Start on a microtask so the loop handle exists even for an immediate failure.
      const work = Promise.resolve().then(() => this.pump(e));
      this.loop = work;
      void work.finally(() => { if (this.loop === work) this.loop = null; }).catch(() => undefined);
    } catch (error) { this.fail(error, e); throw error; }
  }

  private async pump(e: number): Promise<void> {
    try {
      while (this.alive(e) && this.nextIndex < this.artifact.program.steps.length) {
        if (this.pauseWanted) { await this.parkForPause(e); return; }
        const index = this.nextIndex;
        const action = this.artifact.program.steps[index].action;
        this.changed();
        try {
          await this.gate.send(runtimeCommand(this.artifact.tag, 's', this.runId, index));
        } catch (error) {
          // Pause may cancel a command still waiting for its rate slot. It was
          // NOT accepted; do not consume its index. Genuine write failures abort.
          if (error instanceof CanceledCommandError && this.pauseWanted && this.alive(e)) {
            await this.parkForPause(e); return;
          }
          throw error;
        }
        if (!this.alive(e)) return;
        this.nextIndex = index + 1;
        // A requested pause does not shorten this conservative, non-ACK delay.
        // That keeps Resume from replaying or overlapping an accepted pulse.
        await this.delay(this.timing(action));
        if (!this.alive(e)) return;
        this.cursor = this.nextIndex;
        this.changed();
      }
      if (!this.alive(e)) return;
      this.set('finishing');
      const stopped = await this.gate.stop();
      if (!this.alive(e)) return;
      if (!stopped) throw new Error('Final STOP was not written. Attend to Bolt; retry STOP explicitly.');
      this.stopWritten = true;
      // No medal, delivery count or progress is awarded by a timer/write receipt.
      this.set('review');
    } catch (error) { this.fail(error, e); }
  }

  async pause(): Promise<void> {
    if (this.phase !== 'cruising') return;
    this.pauseWanted = true;
    this.set('pausing');
    this.gate.cancel(); // cancels an unsent rate-wait; never preempts accepted GATT
    await this.loop;
  }
  private async parkForPause(e: number): Promise<void> {
    if (!this.alive(e)) return;
    const stopped = await this.gate.stop();
    if (!this.alive(e)) return;
    if (!stopped) throw new Error('Pause STOP was not written. Attend to Bolt before another action.');
    this.stopWritten = true; this.set('paused');
  }
  async resume(nonce: string): Promise<void> {
    if (this.phase !== 'paused') return;
    // The previous loop has completely settled before another pump is created.
    await this.loop;
    if (this.phase !== 'paused' || !this.active()) return;
    await this.arm(nonce);
  }
  confirm(): void {
    if (this.phase !== 'review' || !this.stopWritten || !this.active())
      throw new Error('Wait for the route to finish, then confirm what you actually observed.');
    this.confirmed = this.artifact.program.steps.length;
    this.set('done');
  }
  cancel(): void {
    this.epoch++; this.pauseWanted = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null; this.wake?.(); this.wake = null;
    this.gate.cancel(); this.set('aborted');
  }
  async stop(): Promise<boolean> { this.cancel(); return this.gate.stop(); }
}
