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
const draftKey = (id) => `course.v4.stage.${id}`;
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
    $('status').textContent = `${op}: ${errorText(e)}`;
}
function status(text) { $('status').textContent = text; }
function touchAllowed() { return visible && !disposed && mode === 'idle' && !localBusy && !link?.operation; }
function snapshot() { if (!student)
    throw new Error('Blockly is not ready.'); return clone(B.serialization.workspaces.save(student)); }
function saveValue(key, value) {
    const frozen = clone(value);
    const task = async () => {
        if (!sdk || disposed || (key === 'course.v4.progress' && !progressWritable))
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
    await saveValue('course.v4.progress', progress);
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
    for (const item of assessment.lines) {
        const p = document.createElement('p');
        p.className = item.ok ? 'pass' : 'pending';
        p.textContent = `${item.ok ? '✓' : '○'} ${item.text}`;
        checks.append(p);
    }
    $('codeLabel').textContent = recoveredKey && recoveredKey === assessment.key ? 'Generated from recovered blocks — not downloaded Python' : 'Generated from your device blocks';
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
    $('editorShield').classList.toggle('hidden', idle && !localBusy);
    $('buildStep').classList.toggle('done', assessment.ok);
    $('uploadStep').classList.toggle('done', uploaded());
    $('playStep').classList.toggle('done', progress.cleared[stage.id - 1]);
    $('uploadNotice').textContent = !assessment.ok ? 'Build the example and check your blocks first.' : !connected ? 'Blocks match. Connect your Crowbot, then upload this stage.' : !uploaded() ? 'Upload this stage’s blocks to the device before starting the game.' : stopFault ? 'STOP was not confirmed as sent. Use Send STOP before another round.' : !safety ? 'Stage 3 moves the robot. Confirm the clear, supervised play area.' : 'This program was acknowledged on this connection. Ready to play. Hardware behavior still needs supervision.';
    $('uploadNotice').className = uploaded() && !stopFault ? 'notice success' : 'notice';
    $('upload').textContent = link?.operation === 'upload' ? 'Uploading frozen program…' : 'Upload this stage to device';
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
            marker.textContent = progress.cleared[id - 1] ? 'Completed ✓' : id > unlocked(progress) ? 'Locked' : 'Available';
    });
    $('courseSummary').textContent = progress.cleared.every(Boolean) ? 'All three stages complete! Revisit a stage to practice.' : `${progress.cleared.filter(Boolean).length} / 3 stages complete`;
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
    const saved = await saveValue('course.v4.backup', backup);
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
        $('help').removeAttribute('open');
        $('hint').textContent = stage.hint;
        $('title').textContent = `${id}. ${stage.name}`;
        $('skill').textContent = stage.skill;
        $('effect').textContent = stage.effect;
        $('goal').textContent = `Pass ${stage.goal} pipes · ${stage.gap}px gaps · speed ${stage.speed}`;
        $('sampleLabel').textContent = `Stage ${id} example — read only`;
        $('safety').checked = false;
        loading = true;
        student.updateToolbox(toolbox(stage));
        B.serialization.workspaces.load(example(stage), sample);
        B.svgResize(sample);
        if (sample.setScale)
            sample.setScale(0.66);
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
            game.sim.stage = stage;
            game.sim.score = 0;
            game.sim.y = 245;
            game.sim.pipes = [];
            game.draw();
        }
        await saveValue('course.v4.progress', progress);
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
            const b = await getValue('course.v4.backup');
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
        status(kind === 'copy' ? 'Example copied. Read it, check it, and upload this stage before playing.' : 'Editor restored. Upload again after completing the lesson blocks.');
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
        await saveValue(`course.v4.upload.${id}`, { workspaceSchemaVersion: 4, blockSetId: BLOCK_SET, blockSetVersion: VERSION,
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
        await saveValue('course.v4.readback.raw', { raw: pendingRead.raw, provenance: 'device-readback', timestamp: new Date().toISOString() });
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
        status('Recovered blocks are editable. Check and upload them for this stage before playing.');
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
        status('Confirm a clear, supervised robot area first.');
        return;
    }
    const authorization = receipt;
    mode = 'starting';
    $('result').classList.add('hidden');
    refresh();
    try {
        await link.current(authorization.connection);
        if (!uploaded() || receipt !== authorization)
            throw new Error('Program changed; upload again.');
        roundConnection = authorization.connection;
        pump = newPump(roundConnection);
        if (!await pump.begin())
            throw new Error('Start message was not sent.');
        if (!visible || mode !== 'starting' || !uploaded())
            throw new Error('Start interrupted; no round was launched.');
        game.sim.start(stage);
        mode = 'running';
        $('gameOverlay').classList.add('hidden');
        $('game').focus();
        status('Playing. UP/DOWN only control the bird; no per-tap BLE traffic.');
    }
    catch (e) {
        mode = 'idle';
        fail('Start stage', e);
    }
    refresh();
}
function pipePassed(score) {
    if (mode !== 'running')
        return;
    if (stage.milestone && score % stage.milestone === 0)
        pump?.event('milestone');
    else if (stage.handlers.some(h => h.message === 'pipe'))
        pump?.event('pipe');
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
        status('STOP failed or was canceled. It is not automatically replayed.');
    }
    $('gameOverlay').classList.remove('hidden');
    refresh();
}
async function completeResult(win) {
    const validWin = win && winTicket && winTicket.stage === stage.id && winTicket.key === assessment.key && winTicket.connection === connectionKey(link?.state ?? null);
    if (validWin)
        progress.cleared[stage.id - 1] = true;
    winTicket = null;
    $('result').classList.remove('hidden');
    $('resultTitle').textContent = validWin ? (stage.id === 3 ? 'Course complete!' : 'Stage cleared!') : 'Try this stage again';
    $('resultText').textContent = validWin ? `${stage.goal} pipes passed with the uploaded lesson program. ${progress.assisted[stage.id - 1] ? 'Example-assisted completion.' : 'Your own build completed the lesson.'}` : 'Your blocks are kept. The same unchanged, uploaded program can be used for another try.';
    $('nextStage').classList.toggle('hidden', !validWin || stage.id === 3);
    const saved = await saveValue('course.v4.progress', progress);
    status(validWin ? (saved ? 'Progress saved. Next stage needs its own blocks and a fresh upload.' : 'Stage cleared in this window; progress could not be saved.') : 'Round ended. Priority STOP was sent; hardware execution remains unconfirmed.');
}
async function manualStop() {
    if (!link || link.operation || !visible)
        return;
    if (mode === 'running') {
        await finish(false);
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
    game?.sim.stop();
    pump?.cancel();
    receipt = null;
    winTicket = null;
    if (mode !== 'idle')
        stopFault = true;
    mode = 'idle';
    $('gameOverlay').classList.remove('hidden');
    status(reason);
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
        game = new GameView($('game'), pipePassed, win => { void finish(win); });
        $('retryGraphics').classList.add('hidden');
    }
    catch (e) {
        game = null;
        $('retryGraphics').classList.remove('hidden');
        fail('Canvas 2D initialization', e);
    }
}
function bind() {
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
    listen('check', () => { assess(); status(assessment.ok ? 'Blocks match! Upload this stage to the device before playing.' : 'Not finished yet. Compare the highlighted checklist with the example; a hint is available below.'); });
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
    listen('nextStage', () => selectStage(stage.id + 1));
    listen('up', () => game?.sim.up());
    listen('down', () => game?.sim.down());
    listen('retryGraphics', () => { createGame(); refresh(); });
    listen('confirmYes', () => answer(true));
    listen('confirmNo', () => answer(false));
    $('safety').addEventListener('change', refresh, { signal: listeners.signal });
    document.querySelectorAll('[data-stage]').forEach(btn => btn.addEventListener('click', () => { void selectStage(Number(btn.dataset.stage)).catch(e => fail('Change stage', e)); }, { signal: listeners.signal }));
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
            move: { scrollbars: true, drag: true, wheel: true }, grid: { spacing: 22, length: 2, colour: '#426173', snap: true },
            zoom: { controls: true, wheel: true, startScale: 0.68, minScale: 0.4, maxScale: 1.3 } };
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
            progress = readProgress(await getValue('course.v4.progress'));
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
        console.info(`[Flappy BLE ${VERSION}] three-stage course ready; no hardware action on load`);
    }
    catch (e) {
        fail('Blockly / course startup', e);
        $('sdkWarning').textContent += '\n' + errorText(e);
    }
    refresh();
}
void init().catch(e => fail('Startup', e));
