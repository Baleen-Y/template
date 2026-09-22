import { explainDifference } from './lesson-feedback.js';
export const VERSION = '5.0.0';
export const PROFILE = 'integem-crowbot-mqtt-v1';
export const BLOCK_SET = 'flappy-crowbot-device';
export const MAX_DRAFT = 64 * 1024;
export type Fields = Record<string, string | number>;
export interface BlockJSON {
  type: string; id?: string; x?: number; y?: number; fields?: Fields;
  inputs?: Record<string, { block?: BlockJSON }>;
  next?: { block: BlockJSON }; disabled?: boolean;
  [key: string]: unknown;
}
export interface Snapshot { blocks: { languageVersion: number; blocks: BlockJSON[] }; [key: string]: unknown }
export type Action = { kind: 'light'; state: string } | { kind: 'motor'; side: string; direction: string; speed: number }
  | { kind: 'pulse'; direction: string; speed: number; ms: number } | { kind: 'park' } | { kind: 'stop'; side: string } | { kind: 'delay'; ms: number } | { kind: 'repeat'; count: number; actions: Action[] };
export interface Handler { message: string; actions: Action[] }
export interface Stage {
  id: number; name: string; skill: string; goal: number; gap: number; speed: number; gravity: number; flap: number;
  milestone: number; effect: string; hint: string; handlers: Handler[];
  world: string; promise: string; badge: string; lives: number;
}
const light = (state: string): Action => ({ kind: 'light', state });
const delay = (ms: number): Action => ({ kind: 'delay', ms });
const stop = (side: string): Action => ({ kind: 'stop', side });
const motor = (side: string): Action => ({ kind: 'motor', side, direction: 'FORWARD', speed: 35 });
const repeat = (count: number, actions: Action[]): Action => ({ kind: 'repeat', count, actions });
// Light-only lessons deliberately contain NO motor calls, including their end event.
const lightEnd = (): Handler => ({ message: 'stop', actions: [light('OFF')] });
export const STAGES: Stage[] = [
  { id: 1, name: 'Wake the forest', world: 'Sunbeam Woods', skill: 'Give Bolt a glow', goal: 3, gap: 235, speed: 165, gravity: 780, flap: 330, lives: 3,
    badge: 'Glow Keeper', promise: 'Pip needs a lantern. Can you teach Bolt to light the way?',
    milestone: 0, effect: 'Bolt lights up when your flight begins, and goes dark when you land. Only lights — no wheels.',
    hint: 'Make two messages: start and stop. Put light ON under start. Put light OFF under stop. That is your whole first program!',
    handlers: [{ message: 'start', actions: [light('ON')] }, lightEnd()] },
  { id: 2, name: 'Send a sparkle', world: 'Moonbeam Lagoon', skill: 'Make a light pattern', goal: 5, gap: 200, speed: 195, gravity: 930, flap: 365, lives: 3,
    badge: 'Sparkle Maker', promise: 'The lagoon is sleepy. Every gate you clear sends Bolt a sparkle!',
    milestone: 0, effect: 'Bolt flashes twice whenever you clear a gate. Your repeat block makes the pattern happen on the real robot.',
    hint: 'Inside pipe, add repeat 2. Inside the repeat: light OFF → wait 100 ms → light ON → wait 100 ms. Keep start and stop from mission 1.',
    handlers: [{ message: 'start', actions: [light('ON')] },
      { message: 'pipe', actions: [repeat(2, [light('OFF'), delay(100), light('ON'), delay(100)])] }, lightEnd()] },
  { id: 3, name: 'Rescue the stars', world: 'Starlight Summit', skill: 'Teach Bolt a rescue hop', goal: 7, gap: 170, speed: 225, gravity: 1070, flap: 395, lives: 3,
    badge: 'Star Rescuer', promise: 'Pip finds the stars in the sky. Bolt takes a little rescue hop on the ground!',
    milestone: 3, effect: 'At gates 3 and 6, Bolt rolls twice in short pulses. Each roll stops its own wheels. Play on a clear floor with an adult.',
    hint: 'Inside milestone: repeat 2 → roll FORWARD at 35 for 120 ms → wait 120 ms. Put random light after the repeat. Because this mission uses wheels, stop must park wheels and turn the light OFF.',
    handlers: [{ message: 'start', actions: [light('ON')] }, { message: 'pipe', actions: [light('RANDOM')] },
      { message: 'milestone', actions: [repeat(2, [{kind:'pulse', direction:'FORWARD', speed:35, ms:120}, delay(120)]), light('RANDOM')] },
      { message: 'stop', actions: [{kind:'park'}, light('OFF')] }] }
];
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const byteLength = (value: string): number => new TextEncoder().encode(value).length;
export function chain(blocks: BlockJSON[]): BlockJSON | undefined {
  for (let i = 0; i + 1 < blocks.length; i++) blocks[i].next = { block: blocks[i + 1] };
  return blocks[0];
}
function actionBlock(a: Action): BlockJSON {
  switch (a.kind) {
    case 'light': return { type: 'flappy_light', fields: { STATE: a.state } };
    case 'pulse': return { type: 'flappy_drive_pulse', fields: { DIR: a.direction, SPEED: a.speed, MS: a.ms } };
    case 'park': return { type: 'flappy_park' };
    case 'motor': return { type: 'flappy_motor', fields: { SIDE: a.side, DIR: a.direction, SPEED: a.speed } };
    case 'stop': return { type: 'flappy_motor_stop', fields: { SIDE: a.side } };
    case 'delay': return { type: 'flappy_delay', fields: { MS: a.ms } };
    case 'repeat': return { type: 'flappy_device_repeat', fields: { COUNT: a.count }, inputs: { DO: { block: chain(a.actions.map(actionBlock)) } } };
  }
}
export function blank(): Snapshot { return { blocks: { languageVersion: 0, blocks: [{ type: 'flappy_device_program', x: 20, y: 24 }] } }; }
export function example(stage: Stage): Snapshot {
  const s = blank();
  s.blocks.blocks[0].inputs = { BODY: { block: chain(stage.handlers.map(h => ({
    type: 'flappy_on_message', fields: { MESSAGE: h.message }, inputs: { DO: { block: chain(h.actions.map(actionBlock)) } }
  }))) } };
  return s;
}
const ALLOWED = new Set(['flappy_device_program', 'flappy_on_message', 'flappy_light', 'flappy_motor', 'flappy_motor_stop', 'flappy_delay', 'flappy_device_repeat', 'flappy_drive_pulse', 'flappy_park']);
function pick(b: BlockJSON, name: string, allowed: string[]): string {
  const value = b.fields?.[name];
  if (typeof value !== 'string' || !allowed.includes(value)) throw new Error(`${b.type}: invalid ${name}.`);
  return value;
}
function number(b: BlockJSON, name: string, low: number, high: number): number {
  const n = Number(b.fields?.[name]);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < low || n > high) throw new Error(`${b.type}: ${name} must be ${low}–${high}.`);
  return n;
}
/** Pure compiler input validation; no hardware or browser-side Python execution. */
export function parseProgram(raw: unknown): Handler[] {
  if (!raw || typeof raw !== 'object') throw new Error('Not a Blockly workspace.');
  const snap = raw as Snapshot;
  if (byteLength(JSON.stringify(snap)) > MAX_DRAFT) throw new Error('Lesson workspace exceeds 64 KiB.');
  const top = snap.blocks?.blocks;
  if (!Array.isArray(top) || top.length !== 1 || top[0].type !== 'flappy_device_program') throw new Error('Connect all blocks inside one Crowbot device program.');
  for (const key of Object.keys(snap)) if (key !== 'blocks') throw new Error(`Unsupported workspace serializer: ${key}. Original data is preserved.`);
  let budget = 0;
  const seen = new Set<BlockJSON>();
  function inspect(b: BlockJSON, inputs: string[], fields: string[]): void {
    if (!b || !ALLOWED.has(b.type)) throw new Error(`Unknown block ${b?.type}; requires a matching block set. Expected ${BLOCK_SET} v4.`);
    if (seen.has(b) || ++budget > 180) throw new Error('Cyclic or oversized block program.');
    seen.add(b);
    if (b.disabled === true) throw new Error('Enable or remove disabled blocks before checking.');
    if (b.extraState || b.mutation) throw new Error('Unsupported block extension state.');
    for (const k of Object.keys(b.fields ?? {})) if (!fields.includes(k)) throw new Error(`Unexpected field ${k}.`);
    for (const k of Object.keys(b.inputs ?? {})) if (!inputs.includes(k)) throw new Error(`Unexpected input ${k}.`);
  }
  function actions(first: BlockJSON | undefined, depth = 0): Action[] {
    if (depth > 4) throw new Error('Repeat nesting is limited to four levels.');
    const result: Action[] = [];
    for (let b = first; b; b = b.next?.block) {
      switch (b.type) {
        case 'flappy_light': inspect(b, [], ['STATE']); result.push({ kind: 'light', state: pick(b, 'STATE', ['ON', 'OFF', 'RANDOM']) }); break;
        case 'flappy_drive_pulse': inspect(b, [], ['DIR','SPEED','MS']); result.push({kind:'pulse', direction:pick(b,'DIR',['FORWARD','BACKWARD']), speed:number(b,'SPEED',0,50), ms:number(b,'MS',20,300)}); break;
        case 'flappy_park': inspect(b, [], []); result.push({kind:'park'}); break;
        case 'flappy_motor': inspect(b, [], ['SIDE', 'DIR', 'SPEED']); result.push({ kind: 'motor', side: pick(b, 'SIDE', ['LEFT', 'RIGHT']), direction: pick(b, 'DIR', ['FORWARD', 'BACKWARD']), speed: number(b, 'SPEED', 0, 100) }); break;
        case 'flappy_motor_stop': inspect(b, [], ['SIDE']); result.push({ kind: 'stop', side: pick(b, 'SIDE', ['LEFT', 'RIGHT']) }); break;
        case 'flappy_delay': inspect(b, [], ['MS']); result.push({ kind: 'delay', ms: number(b, 'MS', 0, 10000) }); break;
        case 'flappy_device_repeat': inspect(b, ['DO'], ['COUNT']); result.push({ kind: 'repeat', count: number(b, 'COUNT', 1, 10), actions: actions(b.inputs?.DO?.block, depth + 1) }); break;
        default: throw new Error(`Place only device action blocks inside a message, not ${b.type}.`);
      }
    }
    return result;
  }
  inspect(top[0], ['BODY'], []);
  if (top[0].next) throw new Error('The device-program root cannot have a next block.');
  const handlers: Handler[] = [];
  for (let b = top[0].inputs?.BODY?.block; b; b = b.next?.block) {
    if (b.type !== 'flappy_on_message') throw new Error('Place message conditions directly inside the device program.');
    inspect(b, ['DO'], ['MESSAGE']);
    const message = b.fields?.MESSAGE;
    if (typeof message !== 'string' || !message || byteLength(message) > 80 || /[\u0000-\u001f]/.test(message)) throw new Error('Use a non-empty message of at most 80 UTF-8 bytes.');
    if (handlers.some(h => h.message === message)) throw new Error(`Duplicate message: ${message}.`);
    handlers.push({ message, actions: actions(b.inputs?.DO?.block) });
  }
  return handlers;
}
export interface Check { ok: boolean; lines: { ok: boolean; text: string }[]; handlers: Handler[]; key: string }
export function check(raw: unknown, stage: Stage): Check {
  try {
    const handlers = parseProgram(raw);
    const lines = stage.handlers.map(expected => {
      const actual = handlers.find(h => h.message === expected.message);
      const ok = !!actual && JSON.stringify(actual.actions) === JSON.stringify(expected.actions);
      return { ok, text: ok ? `${expected.message}: matches the example` : !actual
        ? `Add a message handler named "${expected.message}" inside the device program.`
        : `${expected.message}: ${explainDifference(expected.actions, actual.actions)}` };
    });
    const extra = handlers.filter(h => !stage.handlers.some(e => e.message === h.message));
    if (extra.length) lines.push({ ok: false, text: `Remove extra message handlers: ${extra.map(h => h.message).join(', ')}` });
    const key = JSON.stringify([...handlers].sort((a, b) => a.message.localeCompare(b.message)));
    return { ok: lines.every(l => l.ok), lines, handlers, key };
  } catch (error) { return { ok: false, lines: [{ ok: false, text: error instanceof Error ? error.message : String(error) }], handlers: [], key: '' }; }
}
// Teaching vocabulary is replaceable. The BLE transport never whitelists these names.
export const VOCAB: Record<string, string> = {
  ON: 'light_turnon', OFF: 'light_turnoff', RANDOM: 'light_random',
  LEFT_FORWARD: 'moveup_left', RIGHT_FORWARD: 'moveup_right', LEFT_BACKWARD: 'movedown_left', RIGHT_BACKWARD: 'movedown_right',
  LEFT_STOP: 'stopmove_left', RIGHT_STOP: 'stopmove_right'
};
export function generate(raw: unknown, vocabulary = VOCAB): string {
  const handlers = parseProgram(raw);
  const name = (key: string): string => { const n = vocabulary[key]; if (!n || !/^[A-Za-z_]\w*$/.test(n)) throw new Error('Invalid Python function identifier.'); return n; };
  let usesTime = false, loop = 0;
  function emit(list: Action[], level: number): string {
    const pad = '  '.repeat(level);
    if (!list.length) return pad + 'pass\n';
    return list.map(a => {
      switch (a.kind) {
        case 'light': return `${pad}${name(a.state)}()\n`;
        case 'park': return `${pad}${name('LEFT_STOP')}(0)\n${pad}${name('RIGHT_STOP')}(0)\n`;
        case 'pulse': {
          usesTime = true;
          // Both wheel starts have matching stops, even if an action in the pulse fails.
          return `${pad}try:\n${pad}  ${name('LEFT_' + a.direction)}(${a.speed})\n${pad}  ${name('RIGHT_' + a.direction)}(${a.speed})\n${pad}  time.sleep_ms(${a.ms})\n${pad}finally:\n${pad}  ${name('LEFT_STOP')}(0)\n${pad}  ${name('RIGHT_STOP')}(0)\n`;
        }
        case 'motor': return `${pad}${name(a.side + '_' + a.direction)}(${a.speed})\n`;
        case 'stop': return `${pad}${name(a.side + '_STOP')}(0)\n`;
        case 'delay': usesTime = true; return `${pad}time.sleep_ms(${a.ms})\n`;
        case 'repeat': return `${pad}for _lesson_repeat_${++loop} in range(${a.count}):\n${emit(a.actions, level + 1)}`;
      }
    }).join('');
  }
  const body = handlers.map(h => `  if mqtt_msg == ${JSON.stringify(h.message)}:\n${emit(h.actions, 2)}`).join('') || '  pass\n';
  const source = (usesTime ? 'import time\n\n' : '') + 'def MQTT(mqtt_msg, voltage):\n' + body;
  if (source.includes('/n') || source.trimEnd().endsWith('/') || byteLength(source) > 128 * 1024) throw new Error('Source cannot be represented safely by the Crowbot upload protocol.');
  return source;
}
export function registerBlocks(B: any): void {
  const statement = { previousStatement: null, nextStatement: null, colour: 160, helpUrl: '' };
  B.defineBlocksWithJsonArray([
    { type: 'flappy_device_program', message0: 'Bolt’s program %1 %2', args0: [{type:'input_dummy'}, { type: 'input_statement', name: 'BODY' }], colour: 210 },
    { type: 'flappy_on_message', message0: 'when game says %1 %2 %3', args0: [{ type: 'field_input', name: 'MESSAGE', text: 'start' }, {type:'input_dummy'}, { type: 'input_statement', name: 'DO' }], ...statement, colour: 210 },
    { type: 'flappy_light', message0: 'Bolt’s light %1', args0: [{ type: 'field_dropdown', name: 'STATE', options: [['on', 'ON'], ['off', 'OFF'], ['random', 'RANDOM']] }], ...statement },
    { type: 'flappy_motor', message0: '%1 motor %2 speed %3', args0: [{ type: 'field_dropdown', name: 'SIDE', options: [['left', 'LEFT'], ['right', 'RIGHT']] }, { type: 'field_dropdown', name: 'DIR', options: [['forward', 'FORWARD'], ['backward', 'BACKWARD']] }, { type: 'field_number', name: 'SPEED', value: 35, min: 0, max: 100, precision: 1 }], ...statement },
    { type: 'flappy_motor_stop', message0: 'stop %1 motor', args0: [{ type: 'field_dropdown', name: 'SIDE', options: [['left', 'LEFT'], ['right', 'RIGHT']] }], ...statement },
    { type: 'flappy_drive_pulse', message0: 'roll %1 at %2 for %3 ms • then stop', args0: [
      {type:'field_dropdown', name:'DIR', options:[['forward','FORWARD'],['backward','BACKWARD']]},
      {type:'field_number', name:'SPEED', value:35, min:0, max:50, precision:1},
      {type:'field_number', name:'MS', value:120, min:20, max:300, precision:1}], ...statement, colour:28,
      tooltip:'Both wheels start, wait briefly, then both stop on the device. Only use with adult supervision.'},
    { type: 'flappy_park', message0: 'park Bolt’s wheels', ...statement, colour:28 },
    { type: 'flappy_delay', message0: 'wait %1 ms', args0: [{ type: 'field_number', name: 'MS', value: 100, min: 0, max: 10000, precision: 1 }], ...statement, colour: 120 },
    { type: 'flappy_device_repeat', message0: 'repeat %1 times %2', args0: [{ type: 'field_number', name: 'COUNT', value: 2, min: 1, max: 10, precision: 1 }, { type: 'input_statement', name: 'DO' }], ...statement, colour: 120 }
  ]);
}
export function toolbox(stage: Stage): object {
  const cat = (name: string, colour: string, names: string[]) => ({kind:'category', name, colour, contents:names.map(type=>({kind:'block',type}))});
  const contents = [cat('When', '#547ab9', ['flappy_device_program','flappy_on_message']), cat('Lights','#329e84',['flappy_light'])];
  if(stage.id >= 2) contents.push(cat('Repeat','#8a68c1',['flappy_device_repeat','flappy_delay']));
  if(stage.id >= 3) contents.push(cat('Wheels','#c78036',['flappy_drive_pulse','flappy_park']));
  return {kind:'categoryToolbox', contents};
}
export interface Progress { schema: 1; selected: number; cleared: boolean[]; assisted: boolean[]; best: number[] }
export const freshProgress = (): Progress => ({ schema: 1, selected: 1, cleared: [false, false, false], assisted: [false, false, false], best: [0, 0, 0] });
export function readProgress(raw: unknown): Progress {
  const out = freshProgress();
  if (!raw || typeof raw !== 'object') return out;
  const p = raw as Partial<Progress>;
  if (p.schema !== 1) throw new Error('Newer course progress schema; existing data was not overwritten.');
  for (let i = 0; i < 3; i++) {
    out.cleared[i] = p.cleared?.[i] === true && (i === 0 || out.cleared[i - 1]);
    out.assisted[i] = p.assisted?.[i] === true;
    const best = Number(p.best?.[i]); out.best[i] = Number.isFinite(best) ? Math.max(0, Math.min(STAGES[i].goal, best)) : 0;
  }
  out.selected = Math.min(Math.max(1, Math.floor(Number(p.selected) || 1)), unlocked(out));
  return out;
}
export function unlocked(p: Progress): number { return p.cleared[0] ? (p.cleared[1] ? 3 : 2) : 1; }
