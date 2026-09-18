(() => {
  "use strict";

  const W = 800, H = 600, ROUND_SECONDS = 60;
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const $ = (id) => document.getElementById(id);
  const ui = {
    hud: $("hud"), score: $("scoreValue"), time: $("timeValue"), lives: $("livesValue"), combo: $("comboValue"), comboWrap: $("comboWrap"),
    pauseBtn: $("pauseBtn"), muteBtn: $("muteBtn"), titleMuteBtn: $("titleMuteBtn"),
    title: $("titleScreen"), play: $("playBtn"), bestScore: $("bestScore"), scoresBtn: $("scoresBtn"), preview: $("previewBadge"), saveNotice: $("saveNotice"),
    pause: $("pauseScreen"), pauseReason: $("pauseReason"), resume: $("resumeBtn"), restart: $("restartBtn"), menuPause: $("menuBtnFromPause"),
    gameOver: $("gameOverScreen"), resultTitle: $("resultTitle"), finalScore: $("finalScore"), finalStars: $("finalStars"), finalTime: $("finalTime"), bestStatus: $("bestStatus"), playAgain: $("playAgainBtn"), mainMenu: $("mainMenuBtn"),
    scores: $("scoresScreen"), scoresList: $("scoresList"), scoresBack: $("scoresBackBtn"),
    confirm: $("confirmScreen"), confirmTitle: $("confirmTitle"), confirmText: $("confirmText"), confirmYes: $("confirmYesBtn"), confirmNo: $("confirmNoBtn")
  };

  let sdk = null, persistent = false, disposed = false, raf = 0, lastFrame = 0;
  let mode = "menu", pausedFrom = null, confirmAction = null;
  let muted = false, audioCtx = null, rounds = [];
  let score = 0, starsCollected = 0, lives = 3, cleanStars = 0, combo = 1, shield = 0, invulnerable = 0, elapsed = 0;
  let spawnClock = 0, shieldClock = 10, feedback = [], particles = [], objects = [];
  let keys = new Set(), pointerActive = false, pointerX = W / 2;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ship = { x: W / 2, y: H - 66, w: 44, h: 34, vx: 0 };
  const bgStars = Array.from({ length: reducedMotion ? 45 : 90 }, (_, i) => ({ x: Math.random()*W, y: Math.random()*H, r: 0.5+Math.random()*1.4, s: 7+Math.random()*20, p: i%3 }));

  function show(el, yes) { el.classList.toggle("hidden", !yes); }
  function best() { return rounds.length ? Math.max(...rounds.map(r => r.score)) : 0; }
  function setMode(next) {
    mode = next;
    show(ui.title, next === "menu"); show(ui.pause, next === "paused"); show(ui.gameOver, next === "over"); show(ui.scores, next === "scores");
    show(ui.hud, next === "playing" || next === "paused");
    if (next !== "confirm") show(ui.confirm, false);
  }
  function clearKeys() { keys.clear(); ship.vx = 0; pointerActive = false; }

  async function initStorage() {
    if (!window.icreator) { ui.preview.classList.remove("hidden"); renderRecords(); return; }
    try {
      sdk = window.icreator;
      await sdk.ready();
      persistent = true;
      const saved = await sdk.storage.get("star-dash-state");
      if (saved && typeof saved === "object") {
        muted = !!saved.muted;
        rounds = Array.isArray(saved.rounds) ? saved.rounds.slice(0, 5) : [];
      }
      updateMuteLabels(); renderRecords();
      sdk.lifecycle.onVisibilityChange((visible) => { if (!visible && mode === "playing") pauseGame("Window hidden — resume when you're ready."); });
      sdk.lifecycle.onDispose(() => { disposed = true; cancelAnimationFrame(raf); clearKeys(); closeAudio(); });
    } catch (e) {
      persistent = false; sdk = null; ui.preview.classList.remove("hidden");
      notifySave("Progress saving is unavailable, but the game will keep working.");
      renderRecords();
    }
  }

  async function saveState() {
    if (!persistent || !sdk) return false;
    try { await sdk.storage.set("star-dash-state", { muted, rounds: rounds.slice(0,5) }); return true; }
    catch (_) { persistent = false; notifySave("Could not save progress. You can keep playing this session."); return false; }
  }
  function notifySave(text) { ui.saveNotice.textContent = text; ui.saveNotice.classList.remove("hidden"); }
  function renderRecords() {
    ui.bestScore.textContent = String(best());
    ui.scoresList.replaceChildren();
    if (!rounds.length) {
      const li = document.createElement("li"); li.textContent = "No completed rounds yet."; ui.scoresList.appendChild(li); return;
    }
    rounds.forEach((r, i) => {
      const li = document.createElement("li");
      const rank = document.createElement("strong"); rank.textContent = `#${i+1}`;
      const desc = document.createElement("span"); desc.textContent = `${r.score} pts · ${r.stars} stars · ${r.duration.toFixed(1)}s`;
      const date = document.createElement("span"); date.textContent = new Date(r.date).toLocaleDateString();
      li.append(rank, desc, date); ui.scoresList.appendChild(li);
    });
  }

  function ensureAudio() {
    if (muted || audioCtx) return;
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
  }
  function tone(freq, duration, type="sine", gain=.05, slide=0) {
    if (muted) return; ensureAudio(); if (!audioCtx) return;
    const t = audioCtx.currentTime, o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.linearRampToValueAtTime(freq+slide, t+duration);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.001, t+duration);
    o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t+duration);
  }
  function closeAudio() { if (audioCtx) { try { audioCtx.close(); } catch (_) {} audioCtx = null; } }
  function updateMuteLabels() { const t = muted ? "Sound: Off" : "Sound: On"; ui.muteBtn.textContent = t; ui.titleMuteBtn.textContent = t; }
  function toggleMute() { muted = !muted; if (!muted) ensureAudio(); updateMuteLabels(); saveState(); }

  function resetRound() {
    score = 0; starsCollected = 0; lives = 3; cleanStars = 0; combo = 1; shield = 0; invulnerable = 0; elapsed = 0;
    spawnClock = .6; shieldClock = 8 + Math.random()*6; feedback = []; particles = []; objects = []; clearKeys();
    ship.x = W/2; ship.vx = 0; pointerX = ship.x; updateHud();
  }
  function startRound() { ensureAudio(); resetRound(); setMode("playing"); lastFrame = performance.now(); }
  function pauseGame(reason="Paused") { if (mode !== "playing") return; clearKeys(); ui.pauseReason.textContent = reason; setMode("paused"); }
  function resumeGame() { if (mode !== "paused") return; ensureAudio(); lastFrame = performance.now(); setMode("playing"); }
  function requestConfirm(kind) {
    if (mode !== "playing" && mode !== "paused") return;
    pausedFrom = mode; if (mode === "playing") pauseGame("Round paused while you decide.");
    confirmAction = kind; ui.confirmTitle.textContent = kind === "restart" ? "Restart this round?" : "Leave this round?";
    ui.confirmText.textContent = "Your current unfinished run will be lost."; show(ui.confirm, true);
  }
  function resolveConfirm(yes) {
    show(ui.confirm, false);
    if (!yes) { confirmAction = null; if (pausedFrom === "playing") resumeGame(); return; }
    const action = confirmAction; confirmAction = null;
    if (action === "restart") startRound(); else { resetRound(); setMode("menu"); }
  }

  function updateHud() {
    ui.score.textContent = String(score); ui.time.textContent = String(Math.max(0, Math.ceil(ROUND_SECONDS-elapsed)));
    ui.lives.textContent = "♥".repeat(Math.max(0,lives)) + (shield ? "  ◇" : "");
    ui.combo.textContent = combo + "x"; ui.comboWrap.style.opacity = combo > 1 ? "1" : ".7";
  }

  function spawnObject() {
    const difficulty = Math.min(1, elapsed / 48);
    const starChance = .56 - difficulty*.08;
    const kind = Math.random() < starChance ? "star" : "meteor";
    const r = kind === "star" ? 12 : 16 + Math.random()*8;
    objects.push({ kind, x: 34 + Math.random()*(W-68), y: -30, r, vy: (kind === "star" ? 150 : 175) + difficulty*150 + Math.random()*35, rot: Math.random()*6.28, spin: (Math.random()-.5)*2 });
  }
  function spawnShield() { objects.push({ kind:"shield", x:60+Math.random()*(W-120), y:-30, r:15, vy:145, rot:0, spin:1.4 }); }
  function collide(o) { const dx = o.x-ship.x, dy = o.y-ship.y; return Math.abs(dx) < ship.w*.48 + o.r*.72 && Math.abs(dy) < ship.h*.45 + o.r*.72; }
  function addParticles(x,y,color,count=10) {
    if (reducedMotion) count = Math.min(4,count);
    for (let i=0;i<count;i++) particles.push({x,y,vx:(Math.random()-.5)*170,vy:(Math.random()-.5)*170,life:.45+Math.random()*.35,max:.8,r:1+Math.random()*2,color});
  }
  function feedbackText(text,x,y,color) { feedback.push({text,x,y,color,life:.75}); }

  function onHit() {
    if (invulnerable > 0) return;
    cleanStars = 0; combo = 1;
    if (shield) { shield = 0; invulnerable = 1.0; tone(280,.12,"square",.05,180); feedbackText("SHIELD!",ship.x,ship.y-45,"#7ee8ff"); addParticles(ship.x,ship.y,"#7ee8ff",16); }
    else { lives--; invulnerable = 1.25; tone(110,.24,"sawtooth",.06,-35); feedbackText("HIT!",ship.x,ship.y-45,"#ff7f73"); addParticles(ship.x,ship.y,"#ff7f73",18); }
    updateHud(); if (lives <= 0) finishRound(false);
  }
  function collectStar(o) {
    starsCollected++; cleanStars++; if (cleanStars >= 3) combo = 2;
    const gain = 10 * combo; score += gain; tone(combo > 1 ? 880 : 660,.08,"triangle",.045,120);
    feedbackText(`+${gain}`,o.x,o.y,"#ffd85b"); addParticles(o.x,o.y,"#ffd85b",10); updateHud();
  }
  function collectShield(o) { shield = 1; tone(520,.14,"sine",.05,240); feedbackText("SHIELD",o.x,o.y,"#7ee8ff"); addParticles(o.x,o.y,"#7ee8ff",12); updateHud(); }

  async function finishRound(completed) {
    if (mode !== "playing") return;
    const duration = Math.min(ROUND_SECONDS, elapsed), oldBest = best(); clearKeys();
    const record = { score, stars: starsCollected, duration, date: new Date().toISOString() };
    rounds.push(record); rounds.sort((a,b) => b.score-a.score || b.stars-a.stars); rounds = rounds.slice(0,5);
    const newBest = score > oldBest;
    ui.resultTitle.textContent = completed ? "Round Complete" : "Ship Lost";
    ui.finalScore.textContent = String(score); ui.finalStars.textContent = String(starsCollected); ui.finalTime.textContent = duration.toFixed(1)+"s";
    ui.bestStatus.textContent = newBest ? "New Best!" : (score === oldBest && score > 0 ? "Tied Best" : "Recorded");
    setMode("over"); renderRecords(); await saveState();
  }

  function update(dt) {
    if (mode !== "playing") return;
    elapsed += dt; if (elapsed >= ROUND_SECONDS) { elapsed = ROUND_SECONDS; finishRound(true); return; }
    invulnerable = Math.max(0, invulnerable-dt);

    const accel = 980, drag = Math.pow(.0005, dt), maxSpeed = 430;
    let dir = 0; if (keys.has("ArrowLeft") || keys.has("KeyA")) dir--; if (keys.has("ArrowRight") || keys.has("KeyD")) dir++;
    if (pointerActive) {
      const dx = pointerX - ship.x; ship.vx += Math.max(-accel,Math.min(accel,dx*9))*dt;
    } else ship.vx += dir*accel*dt;
    ship.vx *= drag; ship.vx = Math.max(-maxSpeed,Math.min(maxSpeed,ship.vx)); ship.x += ship.vx*dt; ship.x = Math.max(30,Math.min(W-30,ship.x));

    const difficulty = Math.min(1,elapsed/50); spawnClock -= dt; shieldClock -= dt;
    if (spawnClock <= 0) { spawnObject(); const base = .78 - difficulty*.34; spawnClock = Math.max(.36, base + (Math.random()-.5)*.2); }
    if (shieldClock <= 0 && !shield) { spawnShield(); shieldClock = 13 + Math.random()*8; }

    for (let i=objects.length-1;i>=0;i--) {
      const o=objects[i]; o.y += o.vy*dt; o.rot += o.spin*dt;
      if (collide(o)) {
        objects.splice(i,1); if (o.kind === "star") collectStar(o); else if (o.kind === "shield") collectShield(o); else onHit();
        continue;
      }
      if (o.y > H+50) objects.splice(i,1);
    }
    particles.forEach(p => { p.x+=p.vx*dt; p.y+=p.vy*dt; p.vy+=90*dt; p.life-=dt; }); particles = particles.filter(p=>p.life>0);
    feedback.forEach(f=>{f.y-=28*dt; f.life-=dt;}); feedback=feedback.filter(f=>f.life>0);
    updateHud();
  }

  function drawStar(x,y,r,rot=0) {
    ctx.save(); ctx.translate(x,y); ctx.rotate(rot); ctx.beginPath();
    for(let i=0;i<10;i++){ const a=-Math.PI/2+i*Math.PI/5, rr=i%2===0?r:r*.44; const px=Math.cos(a)*rr, py=Math.sin(a)*rr; i?ctx.lineTo(px,py):ctx.moveTo(px,py); }
    ctx.closePath(); ctx.fillStyle="#ffd85b"; ctx.shadowColor="#ffd85b"; ctx.shadowBlur=12; ctx.fill(); ctx.restore();
  }
  function drawMeteor(o) {
    ctx.save(); ctx.translate(o.x,o.y); ctx.rotate(o.rot); ctx.fillStyle="#ff7f73"; ctx.shadowColor="rgba(255,127,115,.35)"; ctx.shadowBlur=10;
    ctx.beginPath(); for(let i=0;i<9;i++){const a=i/9*Math.PI*2, rr=o.r*(.82+Math.sin(i*7.1)*.12); const x=Math.cos(a)*rr,y=Math.sin(a)*rr; i?ctx.lineTo(x,y):ctx.moveTo(x,y);} ctx.closePath(); ctx.fill();
    ctx.fillStyle="#b94f55"; ctx.beginPath(); ctx.arc(-o.r*.25,-o.r*.15,o.r*.2,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(o.r*.28,o.r*.22,o.r*.14,0,Math.PI*2); ctx.fill(); ctx.restore();
  }
  function drawShield(o) { ctx.save(); ctx.translate(o.x,o.y); ctx.rotate(o.rot); ctx.strokeStyle="#7ee8ff"; ctx.lineWidth=4; ctx.shadowColor="#7ee8ff"; ctx.shadowBlur=14; ctx.beginPath(); ctx.arc(0,0,o.r,0,Math.PI*2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0,-9);ctx.lineTo(7,-3);ctx.lineTo(5,7);ctx.lineTo(0,11);ctx.lineTo(-5,7);ctx.lineTo(-7,-3);ctx.closePath();ctx.stroke();ctx.restore(); }
  function drawShip() {
    ctx.save(); ctx.translate(ship.x,ship.y); const protectedNow = invulnerable>0;
    if (protectedNow && Math.floor(invulnerable*12)%2===0) ctx.globalAlpha=.45;
    if (!reducedMotion) { ctx.fillStyle="rgba(44,215,255,.28)"; ctx.beginPath(); ctx.moveTo(-10,16);ctx.lineTo(0,32+Math.random()*7);ctx.lineTo(10,16);ctx.closePath();ctx.fill(); }
    ctx.fillStyle="#29d7f4"; ctx.shadowColor="#29d7f4"; ctx.shadowBlur=14; ctx.beginPath(); ctx.moveTo(0,-22);ctx.lineTo(22,17);ctx.lineTo(7,12);ctx.lineTo(0,19);ctx.lineTo(-7,12);ctx.lineTo(-22,17);ctx.closePath();ctx.fill();
    ctx.fillStyle="#d8fbff";ctx.beginPath();ctx.ellipse(0,-6,6,9,0,0,Math.PI*2);ctx.fill();
    if (shield || protectedNow) { ctx.strokeStyle=shield?"#7ee8ff":"rgba(255,255,255,.8)";ctx.lineWidth=3;ctx.shadowBlur=15;ctx.beginPath();ctx.arc(0,0,31,0,Math.PI*2);ctx.stroke(); }
    ctx.restore();
  }
  function draw(now) {
    ctx.clearRect(0,0,W,H);
    const g=ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,"#071a3a");g.addColorStop(1,"#030814");ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    const t=now/1000;
    for(const s of bgStars){ const y=(s.y+(reducedMotion?0:t*s.s))%H; ctx.globalAlpha=.3+(s.p*.18);ctx.fillStyle="#dff8ff";ctx.fillRect(s.x,y,s.r,s.r); } ctx.globalAlpha=1;
    if (mode !== "menu" && mode !== "scores") {
      for(const o of objects) { if(o.kind==="star") drawStar(o.x,o.y,o.r,o.rot); else if(o.kind==="meteor") drawMeteor(o); else drawShield(o); }
      drawShip();
      for(const p of particles){ctx.globalAlpha=Math.max(0,p.life/p.max);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;
      ctx.textAlign="center";ctx.font="700 18px system-ui";for(const f of feedback){ctx.globalAlpha=Math.max(0,f.life/.75);ctx.fillStyle=f.color;ctx.fillText(f.text,f.x,f.y);}ctx.globalAlpha=1;
    }
  }
  function loop(now) {
    if (disposed) return;
    const dt = Math.min(.033, Math.max(0,(now-lastFrame)/1000 || 0)); lastFrame=now; update(dt); draw(now); raf=requestAnimationFrame(loop);
  }

  function canvasXFromEvent(e) { const r=canvas.getBoundingClientRect(); return (e.clientX-r.left)/r.width*W; }
  canvas.addEventListener("pointerdown", e => { if(mode!=="playing")return; ensureAudio(); pointerActive=true; pointerX=canvasXFromEvent(e); canvas.setPointerCapture?.(e.pointerId); });
  canvas.addEventListener("pointermove", e => { if(mode==="playing" && pointerActive) pointerX=canvasXFromEvent(e); });
  canvas.addEventListener("pointerup", e => { pointerActive=false; canvas.releasePointerCapture?.(e.pointerId); });
  canvas.addEventListener("pointercancel",()=>pointerActive=false);
  addEventListener("keydown", e => {
    if (["ArrowLeft","ArrowRight","KeyA","KeyD","Escape","Space"].includes(e.code)) e.preventDefault();
    if (e.code === "Escape") { if(mode==="playing") pauseGame(); else if(mode==="paused" && ui.confirm.classList.contains("hidden")) resumeGame(); return; }
    if (mode === "playing") keys.add(e.code);
  });
  addEventListener("keyup", e => keys.delete(e.code));
  addEventListener("blur", () => { if(mode==="playing") pauseGame("Window focus changed — resume when you're ready."); clearKeys(); });

  ui.play.addEventListener("click", startRound); ui.pauseBtn.addEventListener("click",()=>pauseGame()); ui.resume.addEventListener("click",resumeGame);
  ui.restart.addEventListener("click",()=>requestConfirm("restart")); ui.menuPause.addEventListener("click",()=>requestConfirm("menu"));
  ui.confirmYes.addEventListener("click",()=>resolveConfirm(true)); ui.confirmNo.addEventListener("click",()=>resolveConfirm(false));
  ui.playAgain.addEventListener("click",startRound); ui.mainMenu.addEventListener("click",()=>{resetRound();setMode("menu");});
  ui.muteBtn.addEventListener("click",toggleMute); ui.titleMuteBtn.addEventListener("click",toggleMute);
  ui.scoresBtn.addEventListener("click",()=>{renderRecords();setMode("scores");}); ui.scoresBack.addEventListener("click",()=>setMode("menu"));

  updateMuteLabels(); renderRecords(); resetRound(); setMode("menu"); initStorage(); lastFrame=performance.now(); raf=requestAnimationFrame(loop);
})();
