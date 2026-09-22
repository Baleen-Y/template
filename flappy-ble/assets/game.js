import { STAGES } from './model.js';
/** Pure game simulation. No SDK, Blockly or device actions are executed here. */
export class Simulation {
    get x() { return Math.min(175, this.width * .24); }
    constructor(onPipe, onEnd, random = Math.random, onHit = () => { }, onStar = () => { }) {
        this.onPipe = onPipe;
        this.onEnd = onEnd;
        this.random = random;
        this.onHit = onHit;
        this.onStar = onStar;
        this.stage = STAGES[0];
        this.width = 900;
        this.y = 245;
        this.velocity = 0;
        this.score = 0;
        this.pipes = [];
        this.running = false;
        this.elapsed = 0;
        this.spawnAt = .4;
        this.lives = 3;
        this.stars = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.invincible = 0;
        this.hits = 0;
        this.lastCenter = 245;
    }
    start(stage) {
        this.stage = stage;
        this.y = 245;
        this.velocity = 0;
        this.score = 0;
        this.pipes = [];
        this.elapsed = 0;
        this.spawnAt = .4;
        this.lastCenter = 245;
        this.lives = stage.lives;
        this.stars = 0;
        this.invincible = 0;
        this.hits = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.running = true;
    }
    up() { if (this.running)
        this.velocity = -this.stage.flap; }
    down() { if (this.running)
        this.velocity = Math.max(150, this.velocity + 140); }
    stop() { this.running = false; }
    update(dt) {
        if (!this.running || !Number.isFinite(dt) || dt < 0)
            return;
        const span = Math.min(dt, .06), steps = Math.max(1, Math.ceil(span / (1 / 120)));
        for (let i = 0; i < steps && this.running; i++)
            this.step(span / steps);
    }
    step(dt) {
        this.elapsed += dt;
        this.invincible = Math.max(0, this.invincible - dt);
        this.velocity += this.stage.gravity * dt;
        this.y += this.velocity * dt;
        if (this.elapsed >= this.spawnAt) {
            const half = this.stage.gap / 2;
            this.lastCenter = Math.max(45 + half, Math.min(490 - 45 - half, this.lastCenter + (this.random() - .5) * (this.stage.id === 1 ? 105 : 155)));
            this.pipes.push({ x: this.width + 30, center: this.lastCenter, counted: false });
            this.spawnAt += 2.6;
        }
        for (const p of this.pipes)
            p.x -= this.stage.speed * dt;
        const radius = 17, x = this.x;
        const wall = this.pipes.find(p => {
            const dx = x - Math.max(p.x - 5, Math.min(x, p.x + 75));
            const top = p.center - this.stage.gap / 2, bottom = p.center + this.stage.gap / 2;
            const dy = this.y < top || this.y > bottom ? 0 : Math.min(this.y - top, bottom - this.y);
            return dx * dx + dy * dy <= radius * radius;
        });
        if (!this.invincible && (this.y - radius < 6 || this.y + radius > 490 || wall)) {
            this.lives--;
            this.hits++;
            this.combo = 0;
            this.onHit(this.lives);
            if (this.lives <= 0) {
                this.running = false;
                this.onEnd(false);
                return;
            }
            // A collision is a recoverable bump, not a forced immediate game over.
            this.y = wall ? wall.center : Math.max(90, Math.min(420, this.y));
            this.velocity = -this.stage.flap * .35;
            this.invincible = 1.45;
            if (wall)
                wall.hit = true;
        }
        for (const p of this.pipes) {
            if (!p.starTaken && Math.hypot(x - (p.x + 35), this.y - p.center) < 34) {
                p.starTaken = true;
                this.stars++;
                this.combo++;
                this.maxCombo = Math.max(this.maxCombo, this.combo);
                this.onStar(this.stars);
            }
            if (!p.counted && p.x + 75 < x - radius) {
                p.counted = true;
                this.score++;
                if (!p.starTaken)
                    this.combo = 0;
                if (this.score >= this.stage.goal) {
                    this.running = false;
                    this.onEnd(true);
                    return;
                }
                this.onPipe(this.score);
            }
        }
        this.pipes = this.pipes.filter(p => p.x > -90);
    }
}
const palettes = [
    { top: '#82d6e0', bottom: '#e8f4ce', hill: '#9ccf9b', far: '#c0dfac', gate: '#499b7e', cap: '#337e6f', shine: '#88cab0', ground: '#639d76' },
    { top: '#6a81bc', bottom: '#d5cfee', hill: '#7ea1b5', far: '#bac1db', gate: '#648fac', cap: '#486f94', shine: '#aac8d6', ground: '#667f9d' },
    { top: '#344c80', bottom: '#b2a1cb', hill: '#777caa', far: '#9b99c0', gate: '#947cb4', cap: '#705b95', shine: '#c6acd9', ground: '#676c95' }
];
export class GameView {
    constructor(canvas, onPipe, onEnd, notify = () => { }) {
        this.canvas = canvas;
        this.notify = notify;
        this.frameId = 0;
        this.last = 0;
        this.visible = true;
        this.disposed = false;
        this.clock = 0;
        this.particles = [];
        this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.frame = (time) => {
            if (this.disposed)
                return;
            const dt = this.last ? Math.min(.06, (time - this.last) / 1000) : 0;
            this.last = time;
            // No off-screen animation/render loop work. Hardware simulation is independent.
            if (this.visible && this.canvas.getBoundingClientRect().width > 0) {
                this.clock += dt;
                this.sim.update(dt);
                this.particles = this.particles.filter(p => { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt; return p.life > 0; });
                this.draw();
            }
            this.frameId = requestAnimationFrame(this.frame);
        };
        const ctx = canvas.getContext('2d');
        if (!ctx)
            throw new Error('Canvas 2D could not start. Use Retry game graphics.');
        this.ctx = ctx;
        this.sim = new Simulation(onPipe, onEnd, Math.random, n => { this.burst(this.sim.x, this.sim.y, '#ffae8c', 14); notify('hit', n); }, n => { this.burst(this.sim.x + 15, this.sim.y, '#ffda6c', 11); notify('star', n); });
        this.observer = new ResizeObserver(() => this.resize());
        this.observer.observe(canvas);
        this.resize();
        this.frameId = requestAnimationFrame(this.frame);
    }
    resize() {
        const box = this.canvas.getBoundingClientRect();
        if (box.width < 2 || box.height < 2)
            return;
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        this.canvas.width = Math.round(box.width * ratio);
        this.canvas.height = Math.round(box.height * ratio);
        this.sim.width = Math.max(180, box.width / box.height * 520);
        this.draw();
    }
    setVisible(v) { this.visible = v; this.last = 0; if (!v)
        this.sim.stop(); }
    burst(x, y, colour, count) {
        if (this.reduced)
            return;
        for (let i = 0; i < count; i++)
            this.particles.push({ x, y, vx: (Math.random() - .5) * 150, vy: (Math.random() - .7) * 160, life: .7 + Math.random() * .3, colour });
        if (this.particles.length > 130)
            this.particles.splice(0, this.particles.length - 130);
    }
    star(x, y, r, colour) {
        const c = this.ctx;
        c.fillStyle = colour;
        c.beginPath();
        for (let i = 0; i < 10; i++) {
            const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .46 : r;
            if (!i)
                c.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
            else
                c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        c.closePath();
        c.fill();
    }
    draw() {
        const c = this.ctx, s = this.sim, w = s.width, pal = palettes[s.stage.id - 1];
        c.setTransform(this.canvas.width / w, 0, 0, this.canvas.height / 520, 0, 0);
        const sky = c.createLinearGradient(0, 0, 0, 520);
        sky.addColorStop(0, pal.top);
        sky.addColorStop(1, pal.bottom);
        c.fillStyle = sky;
        c.fillRect(0, 0, w, 520);
        if (s.stage.id === 1) {
            c.fillStyle = '#fff4b7';
            c.beginPath();
            c.arc(w * .79, 98, 34, 0, Math.PI * 2);
            c.fill();
        }
        else {
            c.fillStyle = '#fff2d6';
            c.beginPath();
            c.arc(w * .79, 92, 28, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = pal.top;
            c.beginPath();
            c.arc(w * .79 + 15, 80, 26, 0, Math.PI * 2);
            c.fill();
            for (let i = 0; i < 22; i++)
                this.star((i * 127 + 43) % w, 35 + (i * 73) % 260, 1.5 + (i % 3), '#ffffff99');
        }
        for (let layer = 0; layer < 2; layer++) {
            c.fillStyle = layer ? pal.hill : pal.far;
            c.beginPath();
            c.moveTo(0, 520);
            for (let x = -40; x < w + 50; x += 15) {
                const y = 430 + layer * 35 + Math.sin((x + s.elapsed * (layer ? 10 : 5)) / 105) * 23 + Math.cos(x / 73) * 14;
                c.lineTo(x, y);
            }
            c.lineTo(w, 520);
            c.fill();
        }
        c.fillStyle = s.stage.id === 1 ? '#ffffffae' : '#f6f1ff35';
        for (let i = 0; i < Math.ceil(w / 215) + 1; i++) {
            const x = (i * 230 + 70 - s.elapsed * 8 + w + 230) % (w + 230) - 90, y = 75 + (i % 3) * 51;
            c.beginPath();
            c.ellipse(x, y, 49, 12, 0, 0, Math.PI * 2);
            c.ellipse(x - 9, y - 8, 27, 16, 0, 0, Math.PI * 2);
            c.ellipse(x + 23, y - 5, 28, 14, 0, 0, Math.PI * 2);
            c.fill();
        }
        for (const p of s.pipes) {
            const top = p.center - s.stage.gap / 2, bottom = p.center + s.stage.gap / 2;
            c.fillStyle = pal.gate;
            c.fillRect(p.x, 0, 70, top);
            c.fillRect(p.x, bottom, 70, 520 - bottom);
            c.fillStyle = pal.shine;
            c.fillRect(p.x + 9, 0, 9, Math.max(0, top - 14));
            c.fillRect(p.x + 9, bottom + 14, 9, 520 - bottom);
            c.fillStyle = pal.cap;
            c.beginPath();
            c.roundRect(p.x - 5, top - 17, 80, 18, 6);
            c.roundRect(p.x - 5, bottom, 80, 18, 6);
            c.fill();
            // Cute carved gate marks and leaves, not a software dashboard.
            c.fillStyle = '#ffffff23';
            for (let y = 32; y < top - 28; y += 54) {
                c.beginPath();
                c.arc(p.x + 42, y, 7, 0, Math.PI * 2);
                c.fill();
            }
            if (!p.starTaken) {
                c.fillStyle = '#fffaee2b';
                c.beginPath();
                c.arc(p.x + 35, p.center, 24 + Math.sin(this.clock * 3) * 3, 0, Math.PI * 2);
                c.fill();
                this.star(p.x + 35, p.center, 14, '#ffdc6e');
            }
            if (s.stage.id === 3 && (s.score + 1) % 3 === 0 && !p.counted) {
                c.fillStyle = '#ffdf9177';
                c.fillRect(p.x - 5, top - 20, 80, 4);
            }
        }
        c.fillStyle = pal.ground;
        c.fillRect(0, 493, w, 27);
        c.fillStyle = '#ffffff3b';
        c.fillRect(0, 490, w, 4);
        for (let i = 0; i < w / 31 + 1; i++) {
            c.fillStyle = '#ffffff28';
            c.beginPath();
            c.arc(i * 31 - (s.elapsed * 20) % 31, 507, 2, 0, Math.PI * 2);
            c.fill();
        }
        if (!s.invincible || Math.floor(this.clock * 12) % 2 === 0) {
            c.save();
            c.translate(s.x, s.y);
            c.rotate(Math.max(-.38, Math.min(.65, s.velocity / 1000)));
            if (s.invincible) {
                c.strokeStyle = '#fff8';
                c.lineWidth = 3;
                c.beginPath();
                c.arc(0, 0, 31, 0, Math.PI * 2);
                c.stroke();
            }
            c.fillStyle = '#e5a938';
            c.beginPath();
            c.moveTo(-20, 1);
            c.lineTo(-34, -11);
            c.lineTo(-27, 8);
            c.lineTo(-35, 14);
            c.lineTo(-16, 14);
            c.fill();
            c.fillStyle = '#ffd05b';
            c.beginPath();
            c.ellipse(0, 0, 23, 20, 0, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = '#ffe59a';
            c.beginPath();
            c.ellipse(-2, 7, 13, 11, 0, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = '#ebae38';
            c.beginPath();
            c.ellipse(-12, 5, 12, 6, -.2 + Math.sin(this.clock * 15) * .22, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = '#f18e5f';
            c.beginPath();
            c.moveTo(19, -1);
            c.lineTo(33, 5);
            c.lineTo(19, 10);
            c.fill();
            c.fillStyle = '#487489';
            c.beginPath();
            c.ellipse(8, -7, 12, 10, -.2, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = '#fff';
            c.beginPath();
            c.arc(11, -7, 8, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = '#224b60';
            c.beginPath();
            c.arc(14, -7, 3.8, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = '#f19a63';
            c.beginPath();
            c.ellipse(12, 10, 5, 3, 0, 0, Math.PI * 2);
            c.fill();
            c.restore();
        }
        for (const p of this.particles) {
            c.globalAlpha = Math.min(1, p.life * 2);
            this.star(p.x, p.y, 3.4, p.colour);
        }
        c.globalAlpha = 1;
    }
    dispose() { this.disposed = true; this.sim.stop(); cancelAnimationFrame(this.frameId); this.observer.disconnect(); this.particles = []; }
}
