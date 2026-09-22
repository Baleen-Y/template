import { Stage, STAGES } from './model.js';
interface Pipe { x: number; center: number; counted: boolean }
export class Simulation {
  stage: Stage = STAGES[0]; y = 245; velocity = 0; score = 0; pipes: Pipe[] = [];
  running = false; elapsed = 0; spawnAt = 0.6; private lastCenter = 245;
  constructor(private onPipe: (score: number) => void, private onEnd: (win: boolean) => void, private random = Math.random) {}
  start(stage: Stage): void {
    this.stage = stage; this.y = 245; this.velocity = 0; this.score = 0; this.pipes = [];
    this.elapsed = 0; this.spawnAt = 0.6; this.lastCenter = 245; this.running = true;
  }
  up(): void { if (this.running) this.velocity = -this.stage.flap; }
  down(): void { if (this.running) this.velocity = Math.max(220, this.velocity + 230); }
  stop(): void { this.running = false; }
  update(dt: number): void {
    if (!this.running) return;
    const steps = Math.max(1, Math.ceil(Math.min(dt, 0.06) / (1 / 120)));
    for (let i = 0; i < steps && this.running; i++) this.step(Math.min(dt, 0.06) / steps);
  }
  private step(dt: number): void {
    this.elapsed += dt; this.velocity += this.stage.gravity * dt; this.y += this.velocity * dt;
    if (this.elapsed >= this.spawnAt) {
      const half = this.stage.gap / 2;
      this.lastCenter = Math.max(50 + half, Math.min(494 - 50 - half, this.lastCenter + (this.random() - 0.5) * 170));
      this.pipes.push({ x: 925, center: this.lastCenter, counted: false });
      this.spawnAt += 2.6;
    }
    for (const p of this.pipes) p.x -= this.stage.speed * dt;
    const radius = 17, x = 175, floor = 494;
    const hit = this.y - radius <= 0 || this.y + radius >= floor || this.pipes.some(p => {
      const dx = x - Math.max(p.x - 5, Math.min(x, p.x + 75));
      const top = p.center - this.stage.gap / 2, bottom = p.center + this.stage.gap / 2;
      const dy = this.y < top ? 0 : this.y > bottom ? 0 : Math.min(this.y - top, bottom - this.y);
      return dx * dx + dy * dy <= radius * radius;
    });
    if (hit) { this.running = false; this.onEnd(false); return; }
    for (const p of this.pipes) {
      if (!p.counted && p.x + 75 < x - radius) {
        p.counted = true; this.score++;
        if (this.score >= this.stage.goal) { this.running = false; this.onEnd(true); return; }
        this.onPipe(this.score);
      }
    }
    this.pipes = this.pipes.filter(p => p.x > -90);
  }
}
export class GameView {
  readonly sim: Simulation; private ctx: CanvasRenderingContext2D; private frameId = 0; private last = 0; private visible = true; private disposed = false;
  constructor(private canvas: HTMLCanvasElement, onPipe: (score: number) => void, onEnd: (win: boolean) => void) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context could not be created. Retry graphics or reopen the module.');
    this.ctx = ctx; this.sim = new Simulation(onPipe, onEnd);
    this.draw(); this.frameId = requestAnimationFrame(this.frame);
  }
  private frame = (time: number): void => {
    if (this.disposed) return;
    if (this.visible) { this.sim.update(this.last ? (time - this.last) / 1000 : 0); this.draw(); }
    this.last = time; this.frameId = requestAnimationFrame(this.frame);
  };
  setVisible(v: boolean): void { this.visible = v; this.last = 0; if (!v) this.sim.stop(); }
  draw(): void {
    const c = this.ctx, s = this.sim;
    const sky = c.createLinearGradient(0, 0, 0, 520); sky.addColorStop(0, '#70d3f4'); sky.addColorStop(1, '#e4f7ee');
    c.fillStyle = sky; c.fillRect(0, 0, 900, 520);
    c.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < 5; i++) {
      const x = (i * 217 - s.elapsed * 9 + 1100) % 1100 - 100, y = 60 + (i % 3) * 65;
      c.beginPath(); c.ellipse(x, y, 53, 17, 0, 0, Math.PI * 2); c.ellipse(x + 12, y - 13, 28, 23, 0, 0, Math.PI * 2); c.fill();
    }
    const colors = ['#269f84', '#477ac6', '#8160bd'];
    for (const p of s.pipes) {
      const top = p.center - s.stage.gap / 2, bottom = p.center + s.stage.gap / 2;
      c.fillStyle = colors[s.stage.id - 1]; c.fillRect(p.x, 0, 70, top); c.fillRect(p.x, bottom, 70, 494 - bottom);
      c.fillRect(p.x - 5, top - 20, 80, 20); c.fillRect(p.x - 5, bottom, 80, 20);
      c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(p.x + 9, 0, 8, top - 20); c.fillRect(p.x + 9, bottom + 20, 8, 494 - bottom);
    }
    c.fillStyle = '#63b26b'; c.fillRect(0, 494, 900, 26); c.fillStyle = '#468b54'; c.fillRect(0, 494, 900, 5);
    c.save(); c.translate(175, s.y); c.rotate(Math.max(-0.4, Math.min(0.7, s.velocity / 800)));
    c.fillStyle = '#ffd45b'; c.beginPath(); c.ellipse(0, 0, 21, 17, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#e9a732'; c.beginPath(); c.ellipse(-8, 6, 12, 6, -0.2, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#f28349'; c.beginPath(); c.moveTo(17, 0); c.lineTo(31, 5); c.lineTo(17, 10); c.fill();
    c.fillStyle = 'white'; c.beginPath(); c.arc(9, -6, 7, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#193142'; c.beginPath(); c.arc(12, -6, 3, 0, Math.PI * 2); c.fill(); c.restore();
    c.font = 'bold 30px system-ui'; c.textAlign = 'center'; c.fillStyle = '#17485c'; c.fillText(`${s.score} / ${s.stage.goal}`, 450, 46);
  }
  dispose(): void { this.disposed = true; this.sim.stop(); cancelAnimationFrame(this.frameId); }
}
