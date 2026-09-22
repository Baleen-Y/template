export const VERSION = '4.0.0';
export const PROFILE = 'integem-crowbot-mqtt-v1';
export const BLOCK_SET = 'flappy-crowbot-device';
export const MAX_DRAFT = 64 * 1024;
const light = (state) => ({ kind: 'light', state });
const delay = (ms) => ({ kind: 'delay', ms });
const stop = (side) => ({ kind: 'stop', side });
const motor = (side) => ({ kind: 'motor', side, direction: 'FORWARD', speed: 35 });
const repeat = (count, actions) => ({ kind: 'repeat', count, actions });
const safety = () => [stop('LEFT'), stop('RIGHT'), light('OFF')];
export const STAGES = [
    { id: 1, name: 'First light', skill: 'Events & sequencing', goal: 3, gap: 235, speed: 145, gravity: 850, flap: 345,
        milestone: 0, effect: 'Start lights the robot. Stop switches the motors and light off.',
        hint: 'Connect two message blocks inside the program: start and stop. Keep both motor-stop blocks before light off.',
        handlers: [{ message: 'start', actions: [light('ON')] }, { message: 'stop', actions: safety() }] },
    { id: 2, name: 'Signal patterns', skill: 'Repeats & timing', goal: 5, gap: 195, speed: 180, gravity: 1000, flap: 380,
        milestone: 0, effect: 'Each passed pipe flashes the light twice. No motor movement in this lesson.',
        hint: 'In the pipe message use repeat 2. Inside it place light off, wait 100 ms, light on, wait 100 ms, in that order.',
        handlers: [{ message: 'start', actions: [light('ON')] },
            { message: 'pipe', actions: [repeat(2, [light('OFF'), delay(100), light('ON'), delay(100)])] },
            { message: 'stop', actions: safety() }] },
    { id: 3, name: 'Robot celebration', skill: 'Coordinated motors & safe stops', goal: 7, gap: 160, speed: 220, gravity: 1150, flap: 410,
        milestone: 3, effect: 'Pipes change the light. At 3 and 6 points the robot performs two short, self-stopping motor pulses.',
        hint: 'Inside milestone, repeat twice: both motors forward 35, wait 120 ms, stop both motors, wait 120 ms. Then random light.',
        handlers: [{ message: 'start', actions: [light('ON')] }, { message: 'pipe', actions: [light('RANDOM')] },
            { message: 'milestone', actions: [repeat(2, [motor('LEFT'), motor('RIGHT'), delay(120), stop('LEFT'), stop('RIGHT'), delay(120)]), light('RANDOM')] },
            { message: 'stop', actions: safety() }] }
];
export const clone = (value) => JSON.parse(JSON.stringify(value));
export const byteLength = (value) => new TextEncoder().encode(value).length;
export function chain(blocks) {
    for (let i = 0; i + 1 < blocks.length; i++)
        blocks[i].next = { block: blocks[i + 1] };
    return blocks[0];
}
function actionBlock(a) {
    switch (a.kind) {
        case 'light': return { type: 'flappy_light', fields: { STATE: a.state } };
        case 'motor': return { type: 'flappy_motor', fields: { SIDE: a.side, DIR: a.direction, SPEED: a.speed } };
        case 'stop': return { type: 'flappy_motor_stop', fields: { SIDE: a.side } };
        case 'delay': return { type: 'flappy_delay', fields: { MS: a.ms } };
        case 'repeat': return { type: 'flappy_device_repeat', fields: { COUNT: a.count }, inputs: { DO: { block: chain(a.actions.map(actionBlock)) } } };
    }
}
export function blank() { return { blocks: { languageVersion: 0, blocks: [{ type: 'flappy_device_program', x: 20, y: 24 }] } }; }
export function example(stage) {
    const s = blank();
    s.blocks.blocks[0].inputs = { BODY: { block: chain(stage.handlers.map(h => ({
                type: 'flappy_on_message', fields: { MESSAGE: h.message }, inputs: { DO: { block: chain(h.actions.map(actionBlock)) } }
            }))) } };
    return s;
}
const ALLOWED = new Set(['flappy_device_program', 'flappy_on_message', 'flappy_light', 'flappy_motor', 'flappy_motor_stop', 'flappy_delay', 'flappy_device_repeat']);
function pick(b, name, allowed) {
    const value = b.fields?.[name];
    if (typeof value !== 'string' || !allowed.includes(value))
        throw new Error(`${b.type}: invalid ${name}.`);
    return value;
}
function number(b, name, low, high) {
    const n = Number(b.fields?.[name]);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < low || n > high)
        throw new Error(`${b.type}: ${name} must be ${low}–${high}.`);
    return n;
}
/** Pure compiler input validation; no hardware or browser-side Python execution. */
export function parseProgram(raw) {
    if (!raw || typeof raw !== 'object')
        throw new Error('Not a Blockly workspace.');
    const snap = raw;
    if (byteLength(JSON.stringify(snap)) > MAX_DRAFT)
        throw new Error('Lesson workspace exceeds 64 KiB.');
    const top = snap.blocks?.blocks;
    if (!Array.isArray(top) || top.length !== 1 || top[0].type !== 'flappy_device_program')
        throw new Error('Connect all blocks inside one Crowbot device program.');
    for (const key of Object.keys(snap))
        if (key !== 'blocks')
            throw new Error(`Unsupported workspace serializer: ${key}. Original data is preserved.`);
    let budget = 0;
    const seen = new Set();
    function inspect(b, inputs, fields) {
        if (!b || !ALLOWED.has(b.type))
            throw new Error(`Unknown block ${b?.type}; requires a matching block set. Expected ${BLOCK_SET} v4.`);
        if (seen.has(b) || ++budget > 180)
            throw new Error('Cyclic or oversized block program.');
        seen.add(b);
        if (b.disabled === true)
            throw new Error('Enable or remove disabled blocks before checking.');
        if (b.extraState || b.mutation)
            throw new Error('Unsupported block extension state.');
        for (const k of Object.keys(b.fields ?? {}))
            if (!fields.includes(k))
                throw new Error(`Unexpected field ${k}.`);
        for (const k of Object.keys(b.inputs ?? {}))
            if (!inputs.includes(k))
                throw new Error(`Unexpected input ${k}.`);
    }
    function actions(first, depth = 0) {
        if (depth > 4)
            throw new Error('Repeat nesting is limited to four levels.');
        const result = [];
        for (let b = first; b; b = b.next?.block) {
            switch (b.type) {
                case 'flappy_light':
                    inspect(b, [], ['STATE']);
                    result.push({ kind: 'light', state: pick(b, 'STATE', ['ON', 'OFF', 'RANDOM']) });
                    break;
                case 'flappy_motor':
                    inspect(b, [], ['SIDE', 'DIR', 'SPEED']);
                    result.push({ kind: 'motor', side: pick(b, 'SIDE', ['LEFT', 'RIGHT']), direction: pick(b, 'DIR', ['FORWARD', 'BACKWARD']), speed: number(b, 'SPEED', 0, 100) });
                    break;
                case 'flappy_motor_stop':
                    inspect(b, [], ['SIDE']);
                    result.push({ kind: 'stop', side: pick(b, 'SIDE', ['LEFT', 'RIGHT']) });
                    break;
                case 'flappy_delay':
                    inspect(b, [], ['MS']);
                    result.push({ kind: 'delay', ms: number(b, 'MS', 0, 10000) });
                    break;
                case 'flappy_device_repeat':
                    inspect(b, ['DO'], ['COUNT']);
                    result.push({ kind: 'repeat', count: number(b, 'COUNT', 1, 10), actions: actions(b.inputs?.DO?.block, depth + 1) });
                    break;
                default: throw new Error(`Place only device action blocks inside a message, not ${b.type}.`);
            }
        }
        return result;
    }
    inspect(top[0], ['BODY'], []);
    if (top[0].next)
        throw new Error('The device-program root cannot have a next block.');
    const handlers = [];
    for (let b = top[0].inputs?.BODY?.block; b; b = b.next?.block) {
        if (b.type !== 'flappy_on_message')
            throw new Error('Place message conditions directly inside the device program.');
        inspect(b, ['DO'], ['MESSAGE']);
        const message = b.fields?.MESSAGE;
        if (typeof message !== 'string' || !message || byteLength(message) > 80 || /[\u0000-\u001f]/.test(message))
            throw new Error('Use a non-empty message of at most 80 UTF-8 bytes.');
        if (handlers.some(h => h.message === message))
            throw new Error(`Duplicate message: ${message}.`);
        handlers.push({ message, actions: actions(b.inputs?.DO?.block) });
    }
    return handlers;
}
export function check(raw, stage) {
    try {
        const handlers = parseProgram(raw);
        const lines = stage.handlers.map(expected => {
            const actual = handlers.find(h => h.message === expected.message);
            const ok = !!actual && JSON.stringify(actual.actions) === JSON.stringify(expected.actions);
            return { ok, text: ok ? `${expected.message}: matches the example` : `${expected.message}: check block order, values and nesting against the example` };
        });
        const extra = handlers.filter(h => !stage.handlers.some(e => e.message === h.message));
        if (extra.length)
            lines.push({ ok: false, text: `Remove extra message handlers: ${extra.map(h => h.message).join(', ')}` });
        const key = JSON.stringify([...handlers].sort((a, b) => a.message.localeCompare(b.message)));
        return { ok: lines.every(l => l.ok), lines, handlers, key };
    }
    catch (error) {
        return { ok: false, lines: [{ ok: false, text: error instanceof Error ? error.message : String(error) }], handlers: [], key: '' };
    }
}
// Teaching vocabulary is replaceable. The BLE transport never whitelists these names.
export const VOCAB = {
    ON: 'light_turnon', OFF: 'light_turnoff', RANDOM: 'light_random',
    LEFT_FORWARD: 'moveup_left', RIGHT_FORWARD: 'moveup_right', LEFT_BACKWARD: 'movedown_left', RIGHT_BACKWARD: 'movedown_right',
    LEFT_STOP: 'stopmove_left', RIGHT_STOP: 'stopmove_right'
};
export function generate(raw, vocabulary = VOCAB) {
    const handlers = parseProgram(raw);
    const name = (key) => { const n = vocabulary[key]; if (!n || !/^[A-Za-z_]\w*$/.test(n))
        throw new Error('Invalid Python function identifier.'); return n; };
    let usesTime = false, loop = 0;
    function emit(list, level) {
        const pad = '  '.repeat(level);
        if (!list.length)
            return pad + 'pass\n';
        return list.map(a => {
            switch (a.kind) {
                case 'light': return `${pad}${name(a.state)}()\n`;
                case 'motor': return `${pad}${name(a.side + '_' + a.direction)}(${a.speed})\n`;
                case 'stop': return `${pad}${name(a.side + '_STOP')}(0)\n`;
                case 'delay':
                    usesTime = true;
                    return `${pad}time.sleep_ms(${a.ms})\n`;
                case 'repeat': return `${pad}for _lesson_repeat_${++loop} in range(${a.count}):\n${emit(a.actions, level + 1)}`;
            }
        }).join('');
    }
    const body = handlers.map(h => `  if mqtt_msg == ${JSON.stringify(h.message)}:\n${emit(h.actions, 2)}`).join('') || '  pass\n';
    const source = (usesTime ? 'import time\n\n' : '') + 'def MQTT(mqtt_msg, voltage):\n' + body;
    if (source.includes('/n') || source.trimEnd().endsWith('/') || byteLength(source) > 128 * 1024)
        throw new Error('Source cannot be represented safely by the Crowbot upload protocol.');
    return source;
}
export function registerBlocks(B) {
    const statement = { previousStatement: null, nextStatement: null, colour: 160, helpUrl: '' };
    B.defineBlocksWithJsonArray([
        { type: 'flappy_device_program', message0: 'Crowbot device program %1', args0: [{ type: 'input_statement', name: 'BODY' }], colour: 210 },
        { type: 'flappy_on_message', message0: 'when game message %1 do %2', args0: [{ type: 'field_input', name: 'MESSAGE', text: 'start' }, { type: 'input_statement', name: 'DO' }], ...statement, colour: 210 },
        { type: 'flappy_light', message0: 'device light %1', args0: [{ type: 'field_dropdown', name: 'STATE', options: [['on', 'ON'], ['off', 'OFF'], ['random', 'RANDOM']] }], ...statement },
        { type: 'flappy_motor', message0: '%1 motor %2 speed %3', args0: [{ type: 'field_dropdown', name: 'SIDE', options: [['left', 'LEFT'], ['right', 'RIGHT']] }, { type: 'field_dropdown', name: 'DIR', options: [['forward', 'FORWARD'], ['backward', 'BACKWARD']] }, { type: 'field_number', name: 'SPEED', value: 35, min: 0, max: 100, precision: 1 }], ...statement },
        { type: 'flappy_motor_stop', message0: 'stop %1 motor', args0: [{ type: 'field_dropdown', name: 'SIDE', options: [['left', 'LEFT'], ['right', 'RIGHT']] }], ...statement },
        { type: 'flappy_delay', message0: 'wait %1 ms', args0: [{ type: 'field_number', name: 'MS', value: 100, min: 0, max: 10000, precision: 1 }], ...statement, colour: 120 },
        { type: 'flappy_device_repeat', message0: 'repeat %1 times %2', args0: [{ type: 'field_number', name: 'COUNT', value: 2, min: 1, max: 10, precision: 1 }, { type: 'input_statement', name: 'DO' }], ...statement, colour: 120 }
    ]);
}
export function toolbox(stage) {
    const names = ['flappy_device_program', 'flappy_on_message', 'flappy_light', 'flappy_motor_stop'];
    if (stage.id >= 2)
        names.push('flappy_device_repeat', 'flappy_delay');
    if (stage.id >= 3)
        names.push('flappy_motor');
    return { kind: 'flyoutToolbox', contents: names.map(type => ({ kind: 'block', type })) };
}
export const freshProgress = () => ({ schema: 1, selected: 1, cleared: [false, false, false], assisted: [false, false, false], best: [0, 0, 0] });
export function readProgress(raw) {
    const out = freshProgress();
    if (!raw || typeof raw !== 'object')
        return out;
    const p = raw;
    if (p.schema !== 1)
        throw new Error('Newer course progress schema; existing data was not overwritten.');
    for (let i = 0; i < 3; i++) {
        out.cleared[i] = p.cleared?.[i] === true && (i === 0 || out.cleared[i - 1]);
        out.assisted[i] = p.assisted?.[i] === true;
        const best = Number(p.best?.[i]);
        out.best[i] = Number.isFinite(best) ? Math.max(0, Math.min(STAGES[i].goal, best)) : 0;
    }
    out.selected = Math.min(Math.max(1, Math.floor(Number(p.selected) || 1)), unlocked(out));
    return out;
}
export function unlocked(p) { return p.cleared[0] ? (p.cleared[1] ? 3 : 2) : 1; }
