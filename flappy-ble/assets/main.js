import { verifyResources } from './resources.js';
import { VERSION, PROFILE, BLOCK_SET, STAGES, blank, example, check, generate, registerBlocks, toolbox, clone, byteLength, freshProgress, readProgress, unlocked } from './model.js';
import { Link, EventPump, connectionKey, errorText } from './device.js';
import { GameView } from './game.js';
const $ = (id) => {
    const el = document.getElementById(id);
    if (!el)
        throw new Error('Missing UI element: ' + id);
    return el;
};
const B = window.Blockly;
let sdk = null, context = null, link = null;
let student = null, sample = null, game = null;
let progress = freshProgress(), stage = STAGES[0], assessment = check(blank(), stage);
let loading = true, disposed = false, visible = true, localBusy = false, protectedDraft = false;
let editorReady = false, progressWritable = true, recoveredKey = '';
let mode = 'idle';
let screen = 'map', roundEpoch = 0, medals = [0, 0, 0];
let toastTimer = null, buddyTimer = null;
const delays = new Set();
let receipt = null;
let roundConnection = '', lastConnection = '', stopFault = false;
let winTicket = null;
let pump = null, saveTimer = null;
let storageTail = Promise.resolve();
const drafts = new Map();
let backup = null;
let pendingRead = null;
let confirmResolve = null, previousFocus = null;
const listeners = new AbortController(), lifecycleOff = [];
let resize = null;
const draftKey = (id) => `course.v5.stage.${id}`;
function log(text, error = false) {
    if (disposed)
        return;
    const row = document.createElement('div');
    row.textContent = `${new Date().toLocaleTimeString()}  ${text}`;
    row.className = error ? 'log-error' : '';
    const box = $('log');
    box.append(row);
    while (box.childElementCount > 100)
        box.firstElementChild?.remove();
    box.scrollTop = box.scrollHeight;
}
function fail(op, e) {
    console.error(`[Flappy BLE ${VERSION}] ${op}`, e);
    log(`${op}: ${errorText(e)}`, true);
    status(`${op}: ${errorText(e)}`, true);
}
function status(text, sticky = false) {
    $('status').textContent = text;
    $('statusToast').classList.remove('quietToast');
    if (toastTimer)
        clearTimeout(toastTimer);
    if (!sticky)
        toastTimer = setTimeout(() => $('statusToast').classList.add('quietToast'), 4300);
}
function show(next) {
    screen = next;
    document.body.dataset.screen = next;
    if (next !== 'play' && document.fullscreenElement === $('playScreen'))
        void document.exitFullscreen().catch(e => log('Exit fullscreen: ' + errorText(e)));
    for (const id of ['map', 'brief', 'build', 'launch', 'play', 'result'])
        $(id + 'Screen').classList.toggle('hidden', id !== next);
    $('appHeader').classList.toggle('hidden', next === 'play');
    $('teacherDrawer').classList.add('hidden');
    $('help').classList.add('hidden');
    window.scrollTo(0, 0);
    requestAnimationFrame(() => {
        if (disposed)
            return;
        if (next === 'build') {
            B.svgResize(student);
            B.svgResize(sample);
        }
        if (next === 'play')
            game?.resize();
    });
}
function buddy(text) {
    $('buddyToast').textContent = text;
    $('buddyToast').classList.remove('hidden');
    if (buddyTimer)
        clearTimeout(buddyTimer);
    buddyTimer = setTimeout(() => $('buddyToast').classList.add('hidden'), 2000);
}
async function delay(ms) {
    await new Promise(resolve => { const t = setTimeout(() => { delays.delete(t); resolve(); }, ms); delays.add(t); });
}
function briefContent() {
    document.body.dataset.mission = String(stage.id);
    $('briefTitle').textContent = stage.name;
    $('briefWorld').textContent = `MISSION ${stage.id} · ${stage.world}`;
    $('briefStory').textContent = stage.promise;
    $('briefBadge').textContent = ['Let’s glow!', 'Sparkle, sparkle!', 'Ready to rescue!'][stage.id - 1];
    const messages = stage.id === 1 ? ['Flight begins → Bolt’s light on', 'Flight ends → Bolt’s light off'] : stage.id === 2 ? ['Clear a gate → two little flashes', 'Repeat makes the pattern', 'Land → turn the light off'] : ['Gate 3 & 6 → a tiny rescue hop', 'Each roll starts AND stops its wheels', 'Land → park wheels and light off'];
    const box = $('missionSteps');
    box.replaceChildren();
    messages.forEach((text, i) => { const row = document.createElement('p'), icon = document.createElement('span'); icon.textContent = ['✦', '↻', '✓'][i]; row.append(icon, document.createTextNode(text)); box.append(row); });
    $('deviceEffect').textContent = stage.effect;
    $('worldLabel').textContent = stage.world;
}
function showCheck() {
    assess();
    $('checkFeedback').classList.remove('hidden');
    $('checkFeedback').classList.toggle('good', assessment.ok);
    $('checkHeadline').textContent = assessment.ok ? 'You made it! Now send it to Bolt.' : 'Almost! Let’s fix one little thing.';
    $('goLaunch').classList.toggle('hidden', !assessment.ok);
    $('buildEncouragement').textContent = assessment.ok ? 'Your code gives Bolt a new trick.' : 'Try the hint. You can do this.';
}
async function goHome() {
    if (!touchAllowed() || pump?.busy)
        return;
    await persist();
    show('map');
    refresh();
}
function touchAllowed() { return visible && !disposed && mode === 'idle' && !localBusy && !link?.operation; }
function snapshot() { if (!student)
    throw new Error('Blockly is not ready.'); return clone(B.serialization.workspaces.save(student)); }
function saveValue(key, value) {
    const frozen = clone(value);
    const task = async () => {
        if (!sdk || disposed || (key === 'course.v5.progress' && !progressWritable))
            return false;
        try {
            if (byteLength(JSON.stringify(frozen)) > 240 * 1024)
                throw new Error('Storage value is too large.');
            await sdk.storage.set(key, frozen);
            return true;
        }
        catch (e) {
            $('storageWarning').textContent = 'Not saved to project storage: ' + errorText(e) + '. Current edits remain in this open window.';
            fail('Save ' + key, e);
            return false;
        }
    };
    const result = storageTail.then(task, task);
    storageTail = result;
    return result;
}
async function getValue(key) {
    if (!sdk)
        return null;
    try {
        return await sdk.storage.get(key);
    }
    catch (e) {
        $('storageWarning').textContent = 'Storage load failed: ' + errorText(e);
        throw e;
    }
}
async function persist() {
    if (!student || protectedDraft)
        return;
    const s = snapshot();
    drafts.set(stage.id, s);
    await saveValue(draftKey(stage.id), s);
    await saveValue('course.v5.progress', progress);
}
function changed() {
    if (loading || disposed || !student)
        return;
    assess();
    if (protectedDraft) {
        status('Saved data needs recovery. Use Start over or Local backup before saving.');
        return;
    }
    drafts.set(stage.id, snapshot());
    if (saveTimer)
        clearTimeout(saveTimer);
    const id = stage.id, captured = snapshot();
    saveTimer = setTimeout(() => { saveTimer = null; void saveValue(draftKey(id), captured); }, 700);
}
function assess() {
    if (!student)
        return;
    try {
        const raw = snapshot();
        assessment = check(raw, stage);
        try {
            $('python').textContent = generate(raw);
        }
        catch (e) {
            $('python').textContent = '# ' + errorText(e);
        }
    }
    catch (e) {
        assessment = { ok: false, key: '', handlers: [], lines: [{ ok: false, text: errorText(e) }] };
    }
    if (receipt && (receipt.stage !== stage.id || receipt.key !== assessment.key || !assessment.ok))
        receipt = null;
    const checks = $('checklist');
    checks.replaceChildren();
    for (const item of (assessment.ok ? [{ ok: true, text: 'The messages, actions and numbers match.' }] : assessment.lines.filter(x => !x.ok).slice(0, 1))) {
        const p = document.createElement('p');
        p.className = item.ok ? 'pass' : 'pending';
        p.textContent = `${item.ok ? '✓' : '○'} ${item.text}`;
        checks.append(p);
    }
    $('codeLabel').textContent = recoveredKey && recoveredKey === assessment.key ? 'Generated from recovered blocks — not downloaded Python' : 'Generated from your device blocks';
    $('goLaunch').classList.toggle('hidden', !assessment.ok);
    if (!$('checkFeedback').classList.contains('hidden')) {
        $('checkFeedback').classList.toggle('good', assessment.ok);
        $('checkHeadline').textContent = assessment.ok ? 'You made it! Now send it to Bolt.' : 'Almost! Let’s fix one little thing.';
    }
    refresh();
}
function uploaded() { return !!receipt && assessment.ok && receipt.stage === stage.id && receipt.key === assessment.key && receipt.connection === connectionKey(link?.state ?? null); }
function refresh() {
    if (disposed)
        return;
    const connected = link?.state?.currentDevice;
    const compatible = connected?.profileId === PROFILE;
    const foreign = !!link?.state?.activity;
    const op = !!link?.operation || localBusy;
    const idle = mode === 'idle';
    $('version').textContent = 'v' + VERSION;
    $('connection').textContent = connected ? `${connected.name} · ${compatible ? 'Connected' : 'Different profile'}` : (link?.operation === 'connect' ? 'Waiting for host chooser…' : 'Not connected');
    $('connection').className = compatible ? 'chip good' : 'chip';
    $('connect').disabled = !link || !!connected || op || !idle || !visible;
    $('disconnect').disabled = !compatible || op || !idle || foreign || pump?.busy === true;
    $('upload').disabled = !compatible || !assessment.ok || op || !idle || foreign || !visible || protectedDraft || pump?.busy === true;
    $('read').disabled = !compatible || op || !idle || foreign || !visible || pump?.busy === true;
    for (const id of ['save', 'reset', 'copyExample', 'restoreBackup'])
        ($(id)).disabled = op || !idle || !student;
    $('check').disabled = !student || op || !idle;
    $('cancel').disabled = !link?.job && link?.operation !== 'read';
    const safety = stage.id < 3 || $('safety').checked;
    const canPlay = uploaded() && !!game && idle && !op && !foreign && !stopFault && !pump?.busy && visible && safety;
    $('start').disabled = !canPlay;
    $('up').disabled = mode !== 'running';
    $('down').disabled = mode !== 'running';
    $('stop').disabled = !compatible || op || mode === 'finishing' || foreign || !visible;
    $('safetyRow').classList.toggle('hidden', stage.id !== 3);
    $('testRobot').disabled = !uploaded() || op || !idle || foreign || !!pump?.busy || stopFault || !visible || !safety;
    $('launchBubble').textContent = uploaded() ? 'I have your code!' : 'Send me your code!';
    $('stopRecovery').classList.toggle('hidden', !stopFault);
    $('lives').textContent = '♥ '.repeat(game?.sim.lives ?? 3).trim();
    $('stars').textContent = '✦ ' + (game?.sim.stars ?? 0);
    $('pause').textContent = mode === 'paused' ? '▶' : 'Ⅱ';
    $('pause').disabled = mode !== 'running' && mode !== 'paused';
    $('resume').disabled = mode !== 'paused' || stopFault;
    $('editorShield').classList.toggle('hidden', idle && !localBusy);
    $('buildStep').classList.toggle('done', assessment.ok);
    $('uploadStep').classList.toggle('done', uploaded());
    $('playStep').classList.toggle('done', progress.cleared[stage.id - 1]);
    $('uploadNotice').textContent = !game ? 'The game picture could not start. Press Retry game graphics below.' : !assessment.ok ? 'Build Bolt’s little program first.' : !connected ? 'Your blocks are ready. Let’s find your robot.' : !uploaded() ? 'One more step: upload your blocks to Bolt.' : stopFault ? 'STOP was not confirmed as sent. Use Send STOP before another round.' : !safety ? 'Ask an adult to check Bolt’s clear play area.' : 'Uploaded! Bolt is ready for this mission. Let’s fly!';
    $('uploadNotice').className = uploaded() && !stopFault ? 'notice success' : 'notice';
    $('upload').textContent = link?.operation === 'upload' ? 'Uploading frozen program…' : 'Upload my blocks';
    $('score').textContent = `${game?.sim.score ?? 0} / ${stage.goal}`;
    $('scoreProgress').max = stage.goal;
    $('scoreProgress').value = game?.sim.score ?? 0;
    $('best').textContent = `Stage best: ${progress.best[stage.id - 1]} · ${progress.assisted[stage.id - 1] ? 'Example-assisted' : 'Build it yourself'}`;
    document.querySelectorAll('[data-stage]').forEach(btn => {
        const id = Number(btn.dataset.stage);
        btn.disabled = id > unlocked(progress) || op || !idle || !!pump?.busy;
        btn.classList.toggle('selected', id === stage.id);
        btn.setAttribute('aria-current', id === stage.id ? 'step' : 'false');
        const marker = btn.querySelector('small');
        if (marker)
            marker.textContent = progress.cleared[id - 1] ? ('Rescued ✓ ' + ('★'.repeat(medals[id - 1]))) : id > unlocked(progress) ? 'Finish the last mission first' : 'Let’s explore!';
    });
    $('courseSummary').textContent = progress.cleared.every(Boolean) ? 'Three worlds rescued! Pick a mission to play again.' : `${progress.cleared.filter(Boolean).length} of 3 worlds rescued · ${medals.reduce((a, b) => a + b, 0)} adventure stars`;
}
function ask(message) {
    if (confirmResolve)
        return Promise.resolve(false);
    $('confirmText').textContent = message;
    $('confirmBox').classList.remove('hidden');
    previousFocus = document.activeElement;
    $('confirmNo').focus();
    return new Promise(resolve => { confirmResolve = resolve; });
}
function answer(value) { const resolve = confirmResolve; confirmResolve = null; $('confirmBox').classList.add('hidden'); resolve?.(value); previousFocus?.focus(); }
async function backupCurrent(reason) {
    backup = { stage: stage.id, workspace: snapshot(), reason };
    const saved = await saveValue('course.v5.backup', backup);
    if (!saved)
        status('Backup kept in this window only; project storage is unavailable.');
}
function validateInBlockly(raw) {
    const candidate = clone(raw);
    generate(candidate);
    const temporary = new B.Workspace();
    try {
        B.serialization.workspaces.load(candidate, temporary);
        return candidate;
    }
    finally {
        temporary.dispose();
    }
}
function loadEditor(raw) {
    loading = true;
    try {
        B.serialization.workspaces.load(clone(raw), student);
        B.svgResize(student);
    }
    finally {
        loading = false;
    }
    receipt = null;
    assess();
}
async function selectStage(id) {
    if (!touchAllowed() || id > unlocked(progress) || id < 1 || id > 3 || pump?.busy)
        return;
    localBusy = true;
    refresh();
    try {
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        if (editorReady)
            await persist();
        stage = STAGES[id - 1];
        progress.selected = id;
        receipt = null;
        winTicket = null;
        recoveredKey = '';
        protectedDraft = false;
        $('result').classList.add('hidden');
        $('readResult').classList.add('hidden');
        $('help').classList.add('hidden');
        $('rescueOptions').classList.add('hidden');
        $('hint').textContent = stage.hint;
        $('title').textContent = `${id}. ${stage.name}`;
        $('skill').textContent = stage.skill;
        $('effect').textContent = stage.effect;
        briefContent();
        $('checkFeedback').classList.add('hidden');
        $('goLaunch').classList.add('hidden');
        $('boards').dataset.board = 'student';
        $('yourTab').classList.add('selected');
        $('exampleTab').classList.remove('selected');
        $('sampleLabel').textContent = 'Look at this example';
        $('safety').checked = false;
        loading = true;
        student.updateToolbox(toolbox(stage));
        B.serialization.workspaces.load(example(stage), sample);
        B.svgResize(sample);
        if (sample.setScale)
            sample.setScale(stage.id === 1 ? .8 : .68);
        let saved = drafts.get(id);
        if (!saved) {
            try {
                saved = await getValue(draftKey(id));
            }
            catch (e) {
                protectedDraft = true;
                fail('Load stage draft', e);
            }
        }
        if (saved) {
            try {
                loadEditor(validateInBlockly(saved));
            }
            catch (e) {
                protectedDraft = true;
                loadEditor(blank());
                fail('Saved draft preserved for recovery', e);
            }
        }
        else
            loadEditor(blank());
        editorReady = true;
        if (game) {
            game.sim.start(stage);
            game.sim.stop();
            game.draw();
        }
        await saveValue('course.v5.progress', progress);
        status(protectedDraft ? 'Existing saved draft was not overwritten. Use recovery or Start over.' : `Stage ${id}: study the example, build your own, upload, then play.`);
    }
    finally {
        loading = false;
        localBusy = false;
        assess();
    }
}
async function replaceEditor(kind) {
    if (!touchAllowed() || pump?.busy)
        return;
    let target;
    if (kind === 'backup') {
        if (!backup) {
            const b = await getValue('course.v5.backup');
            if (b && typeof b === 'object')
                backup = b;
        }
        if (!backup || backup.stage !== stage.id)
            throw new Error('No local backup for the current stage. This is not device readback.');
        target = validateInBlockly(backup.workspace);
    }
    else
        target = kind === 'copy' ? example(stage) : blank();
    const text = kind === 'copy' ? 'Copy the completed example into your editor? Try the hint first. This stage will be marked Example-assisted. Your current blocks are backed up. You must upload again.' : kind === 'reset' ? 'Start this stage again with only an empty program block? Current blocks are backed up; course progress is kept.' : 'Restore this local backup? This is not a fresh read from the device. Upload the restored program before playing.';
    if (!await ask(text) || !touchAllowed())
        return;
    localBusy = true;
    refresh();
    try {
        await backupCurrent('before-' + kind);
        protectedDraft = false;
        if (kind === 'copy')
            progress.assisted[stage.id - 1] = true;
        recoveredKey = '';
        loadEditor(target);
        await persist();
        $('readResult').classList.add('hidden');
        $('help').classList.add('hidden');
        showCheck();
        status(kind === 'copy' ? 'Example added. Look at each block, then upload it to Bolt.' : 'Your blocks are ready to work on.');
    }
    finally {
        localBusy = false;
        refresh();
    }
}
async function upload() {
    if (!touchAllowed() || !link || pump?.busy)
        return;
    assess();
    if (!assessment.ok) {
        status('Your blocks do not match the lesson yet. Read the checklist.');
        return;
    }
    const frozen = snapshot(), source = generate(frozen), key = assessment.key, id = stage.id;
    const expected = connectionKey(link.state);
    receipt = null;
    try {
        const confirmation = await link.upload(frozen, source, expected, (label, percent) => {
            status(`Upload: ${label}`);
            $('transferProgress').value = percent;
        });
        if (disposed)
            return;
        if (confirmation !== 'device-confirmed')
            throw new Error('Upload ended without a device-confirmed acknowledgement. Start remains locked.');
        await link.current(expected);
        assess();
        if (visible && stage.id === id && assessment.ok && assessment.key === key)
            receipt = { stage: id, key, connection: expected };
        const hash = async (text) => {
            if (!crypto.subtle)
                return null;
            const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
            return Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
        };
        await saveValue(`course.v5.upload.${id}`, { workspaceSchemaVersion: 4, blockSetId: BLOCK_SET, blockSetVersion: VERSION,
            generatorVersion: VERSION, adapterId: 'crowbot-esp32-mqtt', adapterVersion: VERSION,
            expectedFirmwareVersion: 'Inspected Crowbot ESP32 compatibility contract; installed revision unverified',
            sourceHash: await hash(source), workspaceHash: await hash(JSON.stringify(frozen)), timestamp: new Date().toISOString(), provenance: 'device-upload', confirmation });
        status(receipt ? 'Upload acknowledged. The matching program is ready for this stage on this connection.' : 'Upload acknowledged, but your program, stage or visibility changed. Upload the current blocks again.');
        $('transferProgress').value = 100;
    }
    catch (e) {
        receipt = null;
        fail('Upload failed; device may have a partial workspace/program. Retry only by clicking Upload.', e);
    }
    finally {
        refresh();
    }
}
async function readDevice() {
    if (!touchAllowed() || !link || pump?.busy)
        return;
    receipt = null;
    pendingRead = null;
    $('readResult').classList.add('hidden');
    try {
        pendingRead = await link.read();
        if (disposed)
            return;
        await saveValue('course.v5.readback.raw', { raw: pendingRead.raw, provenance: 'device-readback', timestamp: new Date().toISOString() });
        validateInBlockly(pendingRead.workspace);
        $('readResult').classList.remove('hidden');
        $('readText').textContent = `Received ${pendingRead.bytes} bytes from device. Replace the editor with these recovered blocks? Current edits will be backed up; the result must pass this stage’s checklist.`;
        status('Device workspace received. It has not replaced your current edits.');
    }
    catch (e) {
        fail('Device readback failed; current edits kept. Local backup remains available.', e);
    }
    finally {
        refresh();
    }
}
async function applyRead() {
    if (!pendingRead || !touchAllowed())
        return;
    const recovered = validateInBlockly(pendingRead.workspace);
    if (!await ask('Replace your current stage editor with the workspace read from the device? Current edits are backed up.'))
        return;
    localBusy = true;
    refresh();
    try {
        await backupCurrent('before-device-readback');
        protectedDraft = false;
        loadEditor(recovered);
        recoveredKey = assessment.key;
        await persist();
        $('codeLabel').textContent = 'Generated from recovered blocks — not downloaded Python';
        $('readResult').classList.add('hidden');
        show('build');
        showCheck();
        status('Recovered blocks are editable. Check and upload them for this mission.');
    }
    finally {
        localBusy = false;
        refresh();
    }
}
function onState() {
    if (!link)
        return;
    const key = connectionKey(link.state), a = link.state?.activity;
    const foreignUpload = a?.kind === 'upload' && !(a.owner.type === 'module' && a.owner.id === context?.module.id);
    if (key !== lastConnection || foreignUpload) {
        receipt = null;
        lastConnection = key;
        if (mode !== 'idle')
            interrupt('Connection or device program changed. Round canceled; upload again.');
    }
    if (mode === 'running' && a && !(a.owner.type === 'module' && a.owner.id === context?.module.id && a.kind === 'send'))
        interrupt('Another client is using the device. Round canceled. Use Send STOP when the device is free.');
    refresh();
}
function newPump(expected) {
    return new EventPump(async (text) => { if (!link)
        throw new Error('iCreator unavailable.'); await link.send(text, expected); }, e => fail('Game message not sent (not retried)', e));
}
async function start() {
    if (!touchAllowed() || !uploaded() || !game || !link || stopFault || pump?.busy)
        return;
    if (stage.id === 3 && !$('safety').checked) {
        status('Ask an adult to check Bolt’s clear play area first.');
        return;
    }
    const authorization = receipt, epoch = ++roundEpoch;
    mode = 'starting';
    $('result').classList.add('hidden');
    $('pausePanel').classList.add('hidden');
    game.sim.start(stage);
    game.sim.stop();
    show('play');
    refresh();
    $('gameOverlay').classList.remove('hidden');
    $('flightHint').textContent = 'Tap or press Space to flap!';
    try {
        for (const n of ['3', '2', '1']) {
            $('countdown').textContent = n;
            await delay(650);
            if (disposed || !visible || epoch !== roundEpoch)
                return;
        }
        await link.current(authorization.connection);
        if (!uploaded() || receipt !== authorization || epoch !== roundEpoch)
            throw new Error('Your robot or program changed. Upload again.');
        roundConnection = authorization.connection;
        pump = newPump(roundConnection);
        if (!await pump.begin())
            throw new Error('The start message was not sent.');
        if (!visible || epoch !== roundEpoch || mode !== 'starting') {
            if (visible && !disposed)
                await pump.stop();
            return;
        }
        game.sim.running = true;
        mode = 'running';
        $('gameOverlay').classList.add('hidden');
        $('game').focus();
        $('status').textContent = 'Tap to flap. Aim for the stars. You have three hearts!';
        $('statusToast').classList.add('quietToast');
    }
    catch (e) {
        if (disposed || epoch !== roundEpoch)
            return;
        mode = 'idle';
        fail('Start flight', e);
        show('launch');
    }
    refresh();
}
async function testRobot() {
    if (!touchAllowed() || !uploaded() || !link || pump?.busy || stopFault)
        return;
    if (stage.id === 3 && !$('safety').checked)
        return;
    mode = 'testing';
    const epoch = ++roundEpoch;
    const demo = newPump(connectionKey(link.state));
    pump = demo;
    refresh();
    $('testStatus').textContent = 'Watch your real Bolt…';
    try {
        if (!await demo.begin())
            throw new Error('Start test was not sent.');
        if (stage.id > 1) {
            if (!await demo.event(stage.id === 3 ? 'milestone' : 'pipe'))
                throw new Error('Trick message was not sent.');
        }
        await delay(750);
        if (!visible || disposed || epoch !== roundEpoch)
            return;
        const ok = await demo.stop();
        stopFault = !ok;
        if (!ok)
            throw new Error('STOP was not sent. Check Bolt.');
        $('testStatus').textContent = 'Did you see Bolt’s trick? Messages sent; check the real device.';
    }
    catch (e) {
        if (!disposed) {
            stopFault = true;
            fail('Robot test', e);
            $('testStatus').textContent = 'Check Bolt. Use Send STOP in Grown-up tools.';
        }
    }
    finally {
        if (!disposed && epoch === roundEpoch) {
            mode = 'idle';
            refresh();
        }
    }
}
async function pauseFlight() {
    if (mode === 'paused') {
        await resumeFlight();
        return;
    }
    if (mode !== 'running')
        return;
    mode = 'finishing';
    game?.sim.stop();
    refresh();
    const ok = await pump?.stop();
    if (disposed || !visible)
        return;
    mode = 'paused';
    stopFault = !ok;
    $('pausePanel').classList.remove('hidden');
    $('pauseText').textContent = ok ? 'Pip is waiting. STOP was sent to Bolt.' : 'STOP needs attention. Check Bolt before continuing.';
    refresh();
}
async function resumeFlight() {
    if (mode !== 'paused' || stopFault || !uploaded() || !link || pump?.busy)
        return;
    const epoch = ++roundEpoch;
    mode = 'starting';
    refresh();
    try {
        pump = newPump(connectionKey(link.state));
        if (!await pump.begin())
            throw new Error('Resume was not sent.');
        if (disposed || !visible || epoch !== roundEpoch)
            return;
        $('pausePanel').classList.add('hidden');
        $('gameOverlay').classList.add('hidden');
        mode = 'running';
        if (game)
            game.sim.running = true;
        $('game').focus();
    }
    catch (e) {
        mode = 'paused';
        fail('Resume flight', e);
    }
    refresh();
}
async function exitFlight() {
    if (mode === 'running') {
        await finish(false);
        return;
    }
    if (mode === 'paused') {
        if (stopFault) {
            show('launch');
            status('Check Bolt. Send STOP before a new flight.', true);
        }
        else
            show('launch');
        mode = 'idle';
        refresh();
        return;
    }
    if (mode === 'starting') {
        roundEpoch++;
        game?.sim.stop();
        mode = 'finishing';
        refresh();
        if (pump) {
            const ok = await pump.stop();
            stopFault = !ok;
        }
        if (disposed)
            return;
        mode = 'idle';
        show('launch');
        refresh();
    }
}
async function fullscreen() {
    const el = $('playScreen');
    try {
        if (document.fullscreenElement)
            await document.exitFullscreen();
        else if (el.requestFullscreen)
            await el.requestFullscreen();
        else
            throw new Error('Fullscreen is unavailable.');
    }
    catch (e) {
        status('Playing in the full module window. Browser fullscreen is not available here.');
        log('Fullscreen fallback: ' + errorText(e));
    }
    game?.resize();
}
function pipePassed(score) {
    if (mode !== 'running')
        return;
    if (stage.milestone && score % stage.milestone === 0) {
        void pump?.event('milestone');
        buddy('✦ Rescue beacon! Bolt gets a hop message.');
    }
    else if (stage.handlers.some(h => h.message === 'pipe')) {
        void pump?.event('pipe');
        if (stage.id === 2)
            buddy('✧ Sparkle signal sent to Bolt!');
    }
    refresh();
}
async function finish(win) {
    if (mode !== 'running')
        return;
    mode = 'finishing';
    game?.sim.stop();
    winTicket = win && receipt ? { ...receipt } : null;
    progress.best[stage.id - 1] = Math.max(progress.best[stage.id - 1], game?.sim.score ?? 0);
    status('Round ended. Dropping pending feedback and sending priority STOP…');
    refresh();
    const stopped = await pump?.stop();
    if (disposed || mode !== 'finishing')
        return;
    mode = 'idle';
    stopFault = !stopped;
    if (stopped)
        await completeResult(win);
    else {
        $('result').classList.remove('hidden');
        $('resultTitle').textContent = 'STOP needs attention';
        $('resultText').textContent = 'No device execution guarantee. Check the robot and use Send STOP. New rounds remain locked.';
        $('nextStage').classList.add('hidden');
        show('result');
        status('STOP failed or was canceled. Check Bolt; use the grown-up Send STOP button.', true);
    }
    $('gameOverlay').classList.remove('hidden');
    refresh();
}
async function completeResult(win) {
    const validWin = !!(win && winTicket && winTicket.stage === stage.id && winTicket.key === assessment.key && winTicket.connection === connectionKey(link?.state ?? null));
    const sim = game?.sim;
    if (validWin) {
        progress.cleared[stage.id - 1] = true;
        const earned = 1 + ((sim?.lives ?? 0) > 1 ? 1 : 0) + ((sim?.stars ?? 0) >= Math.ceil(stage.goal * .6) ? 1 : 0);
        medals[stage.id - 1] = Math.max(medals[stage.id - 1], earned);
        await saveValue('course.v5.medals', medals);
    }
    winTicket = null;
    show('result');
    $('result').classList.remove('hidden');
    $('resultTitle').textContent = validWin ? (stage.id === 3 ? 'You rescued every world!' : 'Look what you did!') : 'One more little flight?';
    $('resultBadge').textContent = validWin ? stage.badge : 'KEEP YOUR CODE. TRY YOUR WINGS.';
    $('resultText').textContent = validWin ? `Pip cleared ${stage.goal} gates with the program you sent to Bolt. ${stage.id < 3 ? 'A new adventure is waiting!' : 'You’re a brilliant team.'}` : 'Bumps are part of learning. Your blocks are safe, and you can try again without rebuilding.';
    const stars = $('rewardStars');
    stars.replaceChildren();
    for (let i = 0; i < 3; i++) {
        const el = document.createElement('span');
        el.textContent = '★';
        el.className = validWin && i < medals[stage.id - 1] ? '' : 'empty';
        stars.append(el);
    }
    const stats = $('flightStats');
    stats.replaceChildren();
    for (const [value, label] of [[`${sim?.score ?? 0}/${stage.goal}`, 'Gates'], [String(sim?.stars ?? 0), 'Sky stars'], [String(sim?.maxCombo ?? 0), 'Best streak']]) {
        const el = document.createElement('span'), n = document.createElement('b');
        n.textContent = value;
        el.append(n, document.createTextNode(label));
        stats.append(el);
    }
    $('nextStage').classList.toggle('hidden', !validWin || stage.id === 3);
    $('retryFlight').classList.toggle('hidden', validWin && stage.id < 3);
    const saved = await saveValue('course.v5.progress', progress);
    if (!saved)
        status('Your adventure progress is kept in this window, but could not be saved.', true);
}
async function manualStop() {
    if (!link || link.operation || !visible)
        return;
    if (mode === 'running') {
        await finish(false);
        return;
    }
    if (mode === 'paused') {
        const ok = await pump?.retryStop();
        stopFault = !ok;
        refresh();
        return;
    }
    if (mode !== 'idle' || pump?.busy)
        return;
    mode = 'finishing';
    refresh();
    const expected = connectionKey(link.state);
    pump = newPump(expected);
    const ok = await pump.retryStop();
    mode = 'idle';
    stopFault = !ok;
    if (ok) {
        status('STOP sent. Device execution is unconfirmed.');
        if (winTicket)
            await completeResult(true);
    }
    refresh();
}
function interrupt(reason) {
    roundEpoch++;
    game?.sim.stop();
    pump?.cancel();
    receipt = null;
    winTicket = null;
    if (mode !== 'idle')
        stopFault = true;
    mode = 'idle';
    $('gameOverlay').classList.remove('hidden');
    if (screen === 'play')
        show('launch');
    status(reason, true);
    log(reason, true);
}
function onData(e) {
    if (!$('showHex').checked || !visible || e.projectSessionId !== link?.state?.projectSessionId || e.connectionId !== link?.state?.currentDevice?.connectionId)
        return;
    $('hex').textContent = e.data.slice(0, 96).map(n => n.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}
function listen(id, fn) {
    $(id).addEventListener('click', () => { void Promise.resolve().then(fn).catch(e => fail(id, e)); }, { signal: listeners.signal });
}
function createGame() {
    game?.dispose();
    try {
        game = new GameView($('game'), pipePassed, win => { void finish(win); }, (kind, value) => { if (mode !== 'running')
            return; if (kind === 'hit')
            buddy(value > 0 ? 'A little bump! Keep flying.' : 'Let’s try again!');
        else if (game && game.sim.combo > 1)
            buddy('✦ Star streak ×' + game.sim.combo); refresh(); });
        $('retryGraphics').classList.add('hidden');
    }
    catch (e) {
        game = null;
        $('retryGraphics').classList.remove('hidden');
        fail('Canvas 2D initialization', e);
    }
}
function bind() {
    listen('home', goHome);
    listen('briefBack', goHome);
    listen('resultMap', goHome);
    listen('continueMission', async () => { await selectStage(Math.min(unlocked(progress), progress.cleared.every(Boolean) ? progress.selected : unlocked(progress))); show('brief'); });
    listen('goBuild', () => show('build'));
    listen('buildBack', () => { if (touchAllowed())
        show('brief'); });
    listen('launchBack', () => { if (touchAllowed())
        show('build'); });
    listen('goLaunch', async () => { assess(); if (assessment.ok && touchAllowed()) {
        await persist();
        show('launch');
        refresh();
    }
    else
        showCheck(); });
    listen('resultBuild', () => show('build'));
    listen('retryFlight', () => { show('launch'); refresh(); });
    listen('yourTab', () => { $('boards').dataset.board = 'student'; $('yourTab').classList.add('selected'); $('exampleTab').classList.remove('selected'); B.svgResize(student); });
    listen('exampleTab', () => { $('boards').dataset.board = 'example'; $('exampleTab').classList.add('selected'); $('yourTab').classList.remove('selected'); B.svgResize(sample); });
    listen('hintButton', () => { $('help').classList.remove('hidden'); $('rescueOptions').classList.add('hidden'); });
    listen('hintClose', () => $('help').classList.add('hidden'));
    listen('showRescue', () => $('rescueOptions').classList.remove('hidden'));
    listen('teacherOpen', () => { $('teacherDrawer').classList.remove('hidden'); $('teacherClose').focus(); });
    listen('teacherClose', () => { $('teacherDrawer').classList.add('hidden'); $('teacherOpen').focus(); });
    listen('testRobot', testRobot);
    listen('pause', pauseFlight);
    listen('resume', resumeFlight);
    listen('exitFlight', exitFlight);
    listen('pauseExit', exitFlight);
    // Native fullscreen is optional and is requested directly in the trusted click callback.
    $('fullscreen').addEventListener('click', () => { void fullscreen(); }, { signal: listeners.signal });
    listen('dismissStatus', () => $('statusToast').classList.add('quietToast'));
    listen('connect', () => link?.connect());
    listen('disconnect', async () => {
        if (await ask('Disconnect the shared Bluetooth device? This affects all modules in this project.')) {
            receipt = null;
            await link?.disconnect();
        }
    });
    listen('upload', upload);
    listen('read', readDevice);
    listen('replaceRead', applyRead);
    listen('keepEdits', () => $('readResult').classList.add('hidden'));
    listen('cancel', async () => {
        if (link?.job) {
            if (await ask('Cancel this upload? The shared device will disconnect and may contain a partial program. Cancellation is not rollback.')) {
                receipt = null;
                await link.cancelUpload();
            }
        }
        else
            link?.cancelRead();
    });
    listen('save', async () => { await persist(); status('Save requested. Any storage errors remain visible below.'); });
    listen('check', showCheck);
    listen('copyExample', () => replaceEditor('copy'));
    listen('reset', () => replaceEditor('reset'));
    listen('restoreBackup', () => replaceEditor('backup'));
    listen('fitExample', () => { sample?.zoomToFit(); if (sample?.scale < 0.45)
        sample.setScale(0.45); });
    listen('fitStudent', () => { student?.zoomToFit(); if (student?.scale < 0.45)
        student.setScale(0.45); });
    listen('checkResources', async () => {
        const button = $('checkResources');
        button.disabled = true;
        $('resourceStatus').textContent = 'Checking packaged local resources…';
        try {
            $('resourceStatus').textContent = await verifyResources(listeners.signal);
        }
        catch (e) {
            if (!disposed) {
                $('resourceStatus').textContent = 'Local resource check failed: ' + errorText(e) + '. Confirm that iCreator includes the 2026-09-22 resource-import update, then update the module from the complete ZIP.';
                fail('Local resource check', e);
            }
        }
        finally {
            if (!disposed)
                button.disabled = false;
        }
    });
    listen('start', start);
    listen('stop', manualStop);
    listen('nextStage', async () => { await selectStage(stage.id + 1); show('brief'); });
    listen('up', () => game?.sim.up());
    listen('down', () => game?.sim.down());
    listen('retryGraphics', () => { createGame(); refresh(); });
    listen('confirmYes', () => answer(true));
    listen('confirmNo', () => answer(false));
    $('safety').addEventListener('change', refresh, { signal: listeners.signal });
    document.querySelectorAll('[data-stage]').forEach(btn => btn.addEventListener('click', () => { void selectStage(Number(btn.dataset.stage)).then(() => show('brief')).catch(e => fail('Change stage', e)); }, { signal: listeners.signal }));
    $('game').addEventListener('pointerdown', () => game?.sim.up(), { signal: listeners.signal });
    window.addEventListener('keydown', e => {
        if (confirmResolve) {
            if (e.key === 'Escape') {
                e.preventDefault();
                answer(false);
            }
            if (e.key === 'Tab') {
                e.preventDefault();
                (document.activeElement === $('confirmNo') ? $('confirmYes') : $('confirmNo')).focus();
            }
            return;
        }
        const target = e.target instanceof Element ? e.target : null;
        if (e.repeat || target?.closest('input,textarea,select,[contenteditable="true"],.blocklySvg,.blocklyWidgetDiv') || mode !== 'running')
            return;
        if (e.key === 'Escape') {
            e.preventDefault();
            void pauseFlight();
            return;
        }
        if (e.key === 'ArrowUp' || e.code === 'Space') {
            e.preventDefault();
            game?.sim.up();
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            game?.sim.down();
        }
    }, { signal: listeners.signal });
}
function dispose() {
    if (disposed)
        return;
    answer(false);
    disposed = true;
    visible = false;
    if (saveTimer)
        clearTimeout(saveTimer);
    if (toastTimer)
        clearTimeout(toastTimer);
    if (buddyTimer)
        clearTimeout(buddyTimer);
    delays.forEach(clearTimeout);
    delays.clear();
    roundEpoch++;
    listeners.abort();
    lifecycleOff.splice(0).forEach(off => off());
    resize?.disconnect();
    pump?.cancel();
    game?.dispose();
    link?.dispose();
    student?.dispose();
    sample?.dispose();
    console.info(`[Flappy BLE ${VERSION}] disposed; shared BLE was not disconnected`);
}
async function init() {
    bind();
    createGame();
    if (window.icreator) {
        try {
            sdk = window.icreator;
            context = await sdk.ready();
            console.info(`[Flappy BLE ${VERSION}] SDK ready`, context.apiVersion, context.platform);
            const d = sdk.lifecycle.onDispose(dispose);
            if (d)
                lifecycleOff.push(d);
            const v = sdk.lifecycle.onVisibilityChange(shown => {
                visible = shown;
                link?.setVisible(shown);
                game?.setVisible(shown);
                if (!shown) {
                    answer(false);
                    if (mode !== 'idle')
                        interrupt('Module hidden: round canceled. No hidden BLE send was attempted. Use Send STOP when visible, then upload again.');
                }
                refresh();
            });
            if (v)
                lifecycleOff.push(v);
            if (context.capabilities.device.available) {
                link = new Link(sdk, context, onState, text => log(text), onData);
                await link.init();
            }
            else
                $('sdkWarning').textContent = context.capabilities.device.unavailableReason || 'Bluetooth is unavailable in this host.';
        }
        catch (e) {
            $('sdkWarning').textContent = 'iCreator initialization: ' + errorText(e);
            fail('SDK initialization', e);
        }
    }
    else
        $('sdkWarning').textContent = 'Open this module in iCreator. Examples and editing are available, but Bluetooth and course play are disabled.';
    if (disposed)
        return;
    try {
        if (!B?.serialization?.workspaces)
            throw new Error('The locally bundled Blockly runtime is missing. Re-import the complete release folder.');
        registerBlocks(B);
        const options = { renderer: 'zelos', sounds: false, media: './assets/vendor/media/',
            move: { scrollbars: true, drag: true, wheel: true }, grid: { spacing: 22, length: 2, colour: '#cbded2', snap: true },
            zoom: { controls: true, wheel: true, startScale: 0.85, minScale: 0.4, maxScale: 1.6 } };
        student = B.inject('student', { ...options, toolbox: toolbox(stage), trashcan: true, maxInstances: { flappy_device_program: 1 } });
        sample = B.inject('sample', { ...options, readOnly: true, trashcan: false });
        student.addChangeListener((e) => { if (!e.isUiEvent)
            changed(); });
        resize = new ResizeObserver(() => { if (!disposed) {
            B.svgResize(student);
            B.svgResize(sample);
        } });
        resize.observe($('boards'));
        try {
            const current = await getValue('course.v5.progress');
            const previous = current ?? await getValue('course.v4.progress');
            progress = readProgress(previous);
            const oldMedals = await getValue('course.v5.medals');
            if (Array.isArray(oldMedals))
                medals = STAGES.map((_, i) => Math.max(0, Math.min(3, Number(oldMedals[i]) || 0)));
            if (!current && previous)
                $('legacy').textContent = 'Your unlocked missions are kept. The new robot lessons have fresh workspaces; old v4 work is still saved.';
        }
        catch (e) {
            progressWritable = false;
            fail('Progress load; saved data kept', e);
            $('storageWarning').textContent = 'Existing progress could not be read. Do not overwrite it; reopen after fixing the storage/schema error.';
        }
        try {
            const legacy = await getValue('deviceWorkspace.v3');
            if (legacy)
                $('legacy').textContent = 'Your v3 device workspace is kept unchanged in storage. These three lesson drafts are separate.';
        }
        catch (e) {
            log('Legacy workspace check: ' + errorText(e), true);
        }
        loading = false;
        await selectStage(progress.selected);
        show('map');
        console.info(`[Flappy BLE ${VERSION}] three-stage course ready; no hardware action on load`);
    }
    catch (e) {
        fail('Blockly / course startup', e);
        $('sdkWarning').textContent += '\n' + errorText(e);
    }
    refresh();
}
void init().catch(e => fail('Startup', e));
