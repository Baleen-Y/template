export const VERSION = '1.1.0';
export const MODULE_ID = 'crowbot-parcel-pals';
export const PROFILE = 'integem-crowbot-mqtt-v1';
export const BLOCK_SET = 'parcel-route-v1';
export interface BlockJSON { type: string; id?: string; x?: number; y?: number; data?: string; fields?: Record<string, unknown>; inputs?: Record<string, {block?: BlockJSON; shadow?: BlockJSON}>; next?: {block: BlockJSON}; disabled?: boolean; enabled?: boolean; [key: string]: unknown }
export interface Snapshot { blocks: {languageVersion: number; blocks: BlockJSON[]}; [key: string]: unknown }
export type Action = 'forward' | 'left' | 'right' | 'deliver' | 'park';
export interface Step { action: Action; blockId?: string }
export interface Tuning { schema: 1; speed: number; forwardMs: number; leftMs: number; rightMs: number }
export const DEFAULT_TUNING: Tuning = {schema: 1, speed: 30, forwardMs: 350, leftMs: 280, rightMs: 280};
export interface Position {x: number; y: number; direction: number}
export interface House {x: number; y: number; name: string; emoji: string; parcel: string}
export interface Mission {id: number; title: string; subtitle: string; skill: string; icon: string; color: string; width: number; height: number; start: Position; houses: House[]; blocked: [number,number][]; example: RouteNode[]; hint: string; maxSteps: number}
export type RouteNode = Action | {repeat: number; actions: RouteNode[]};
export const MISSIONS: Mission[] = [
  {id:1,title:'A parcel for Maple',subtitle:'The first delivery',skill:'Put steps in order',icon:'🐰',color:'mint',width:4,height:3,start:{x:0,y:1,direction:1},houses:[{x:2,y:1,name:'Maple',emoji:'🐰',parcel:'a carrot picnic'}],blocked:[[1,0],[1,2],[3,0],[3,2]],example:['forward','forward','deliver','park'],hint:'Bolt starts facing right. Move two squares forward, deliver at Maple’s house, then park.',maxSteps:8},
  {id:2,title:'Around the little pond',subtitle:'A corner to discover',skill:'Turn, then move',icon:'🦊',color:'peach',width:4,height:4,start:{x:0,y:0,direction:1},houses:[{x:2,y:2,name:'Finn',emoji:'🦊',parcel:'a storybook'}],blocked:[[0,1],[1,1],[0,2],[1,2],[3,1]],example:['forward','forward','right','forward','forward','deliver','park'],hint:'Go forward twice along the top path. Turn right to face down. Move twice, deliver the book, then park.',maxSteps:14},
  {id:3,title:'Two friends, one route',subtitle:'The neighborhood round',skill:'Make a repeating pattern',icon:'🐻',color:'lavender',width:4,height:4,start:{x:0,y:0,direction:1},houses:[{x:2,y:0,name:'Milo',emoji:'🐻',parcel:'a berry basket'},{x:2,y:2,name:'Olive',emoji:'🐨',parcel:'an art kit'}],blocked:[[0,1],[1,1],[0,2],[1,2],[3,1]],example:[{repeat:2,actions:['forward','forward','deliver','right']},'park'],hint:'Repeat this pattern twice: forward, forward, deliver, turn right. Put park AFTER the repeat block. One repeat can serve two friends!',maxSteps:16}
];
export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
export const byteLength = (s: string): number => new TextEncoder().encode(s).length;
export const ACTION_LABEL: Record<Action,string> = {forward:'Move one square',left:'Turn left',right:'Turn right',deliver:'Deliver parcel',park:'Park & finish'};
export const ACTION_ICON: Record<Action,string> = {forward:'↑',left:'↶',right:'↷',deliver:'🎁',park:'🏁'};
export function tuning(raw: unknown): Tuning {
  if (!raw || typeof raw !== 'object') throw new Error('Robot settings are missing or invalid.');
  const t = raw as Tuning;
  if (t.schema!==1) throw new Error('This robot-settings version needs a matching Parcel Pals module.');
  for (const key of Object.keys(t)) if (!['schema','speed','forwardMs','leftMs','rightMs'].includes(key)) throw new Error('Unknown robot setting: '+key);
  for (const [key,low,high] of [['speed',15,45],['forwardMs',80,1000],['leftMs',80,1000],['rightMs',80,1000]] as const) {
    if (!Number.isInteger(t[key]) || t[key]<low || t[key]>high) throw new Error(`${key} must be ${low}–${high}. Values were not changed.`);
  }
  return clone(t);
}
export function blank(t: Tuning = DEFAULT_TUNING): Snapshot {
  return {blocks:{languageVersion:0,blocks:[{type:'parcel_program',x:28,y:30,data:JSON.stringify(tuning(t))}]}};
}
function chain(nodes: RouteNode[]): BlockJSON | undefined {
  const blocks = nodes.map(n => typeof n === 'string' ? {type:'parcel_'+n} as BlockJSON : {type:'parcel_repeat',fields:{COUNT:n.repeat},inputs:{DO:{block:chain(n.actions)}}} as BlockJSON);
  blocks.forEach((b,i)=>{if(i+1<blocks.length)b.next={block:blocks[i+1]};});
  return blocks[0];
}
export function example(m: Mission,t: Tuning = DEFAULT_TUNING): Snapshot {
  const s=blank(t);s.blocks.blocks[0].inputs={DO:{block:chain(m.example)}};return s;
}
export interface Program {steps: Step[]; tuning:Tuning; repeats:number}
export function parse(raw: unknown): Program {
  if(!raw||typeof raw!=='object')throw new Error('Not a Blockly workspace. Your current blocks were kept.');
  const s=raw as Snapshot;
  if(byteLength(JSON.stringify(s))>48*1024)throw new Error('Keep this lesson under 48 KiB of blocks.');
  for(const key of Object.keys(s)) if(key!=='blocks')throw new Error('Unrecognized workspace serializer: '+key+'. Use its original editor.');
  if(!Array.isArray(s.blocks?.blocks)||s.blocks.blocks.length!==1||s.blocks.blocks[0].type!=='parcel_program')throw new Error('Connect every block inside ONE “My delivery route” block.');
  const root=s.blocks.blocks[0], seen=new Set<BlockJSON>(); let count=0,repeats=0;
  function inspect(b:BlockJSON,inputs:string[],fields:string[]):void {
    if(!b||typeof b!=='object'||seen.has(b)||++count>100)throw new Error('Too many blocks, or a cyclic route.');seen.add(b);
    if(b.disabled||b.enabled===false)throw new Error('Enable or remove the disabled blocks.');
    if(b.extraState||b.mutation)throw new Error('Unsupported block extension; original data is preserved.');
    for(const k of Object.keys(b.inputs??{}))if(!inputs.includes(k)||b.inputs?.[k]?.shadow)throw new Error('Unexpected block input: '+k);
    for(const k of Object.keys(b.fields??{}))if(!fields.includes(k))throw new Error('Unexpected block field: '+k);
  }
  inspect(root,['DO'],[]);if(root.next)throw new Error('Put the route INSIDE the program, not after it.');
  let t=DEFAULT_TUNING;
  if(root.data){try{t=tuning(JSON.parse(root.data));}catch(e){throw new Error('Saved robot settings: '+(e as Error).message);}}
  function walk(b:BlockJSON|undefined,depth:number):Step[]{
    if(depth>2)throw new Error('Use at most two repeat levels.');const result:Step[]=[];
    while(b){
      if(b.type==='parcel_repeat'){
        inspect(b,['DO'],['COUNT']);const n=Number(b.fields?.COUNT);
        if(!Number.isInteger(n)||n<2||n>4)throw new Error('Repeat count must be 2–4.');repeats++;
        const body=walk(b.inputs?.DO?.block,depth+1);if(!body.length)throw new Error('Put some steps inside repeat.');
        for(let i=0;i<n;i++)result.push(...body);
      }else{
        const action=b.type?.replace(/^parcel_/,'') as Action;
        if(!Object.keys(ACTION_LABEL).includes(action)||!b.type.startsWith('parcel_'))throw new Error(`Unknown block ${b.type}. Requires ${BLOCK_SET}.`);
        inspect(b,[],[]);result.push({action,blockId:b.id});
      }
      if(result.length>24)throw new Error('Your route is too long. Keep it to 24 steps.');b=b.next?.block;
    }return result;
  }
  return {steps:walk(root.inputs?.DO?.block,0),tuning:t,repeats};
}
export interface Trace {position:Position; delivered:number; action:Action; blockId?:string}
export interface Assessment {ok:boolean; message:string; trace:Trace[]; program:Program; key:string}
export function evaluate(raw:unknown,m:Mission):Assessment{
  let program:Program={steps:[],tuning:clone(DEFAULT_TUNING),repeats:0};const trace:Trace[]=[];
  try{
    program=parse(raw);if(!program.steps.length)throw new Error('Start with a “Move one square” block.');
    if(program.steps.length>m.maxSteps)throw new Error(`Try a shorter route: at most ${m.maxSteps} steps for this mission.`);
    if(m.id===1&&program.steps.some(s=>s.action==='left'||s.action==='right'))throw new Error('No turns needed on the first delivery. Try going straight.');
    if(m.id===3&&!program.repeats)throw new Error('This challenge needs a repeat block. Look for a pattern that happens twice.');
    let p={...m.start},delivered=0,parked=false;
    for(const [i,s] of program.steps.entries()){
      if(parked)throw new Error('Park is the last step. Move the extra blocks before it.');
      switch(s.action){
        case 'forward':{const [dx,dy]=[[0,-1],[1,0],[0,1],[-1,0]][p.direction];p={...p,x:p.x+dx,y:p.y+dy};
          if(p.x<0||p.x>=m.width||p.y<0||p.y>=m.height)throw new Error(`Step ${i+1} goes off the map. Turn before the edge.`);
          if(m.blocked.some(([x,y])=>x===p.x&&y===p.y))throw new Error(`Step ${i+1} enters the pond. Try another path.`);break;}
        case 'left':p.direction=(p.direction+3)%4;break;
        case 'right':p.direction=(p.direction+1)%4;break;
        case 'deliver':{const h=m.houses[delivered];if(!h)throw new Error('All parcels are delivered. Park next.');
          if(p.x!==h.x||p.y!==h.y)throw new Error(`Step ${i+1}: reach ${h.name}’s house before “Deliver parcel”.`);delivered++;break;}
        case 'park':if(delivered!==m.houses.length)throw new Error('Deliver to every friend before parking.');parked=true;break;
      }trace.push({position:{...p},delivered,...s});
    }
    if(!parked)throw new Error('Finish your route with “Park & finish”.');
    return {ok:true,message:'Your route reaches every friend. Ready to send to Bolt!',trace,program,key:identity(program,m.id)};
  }catch(e){return {ok:false,message:(e as Error).message,trace,program,key:''};}
}
export function identity(p:Program,mission:number):string{return JSON.stringify({blockSet:BLOCK_SET,runtime:2,mission,steps:p.steps.map(s=>s.action),tuning:p.tuning});}
/** A routing tag only. Full normalized identity is used for local receipt equality. Not an integrity/security proof. */
export function tag(key:string):string{let a=2166136261,b=5381;for(const c of new TextEncoder().encode(key)){a=Math.imul(a^c,16777619);b=Math.imul(b,33)^c;}return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');}
export const VOCAB = {lf:'moveup_left',rf:'moveup_right',lb:'movedown_left',rb:'movedown_right',ls:'stopmove_left',rs:'stopmove_right',on:'light_turnon',off:'light_turnoff'};
export interface Artifact {source:string;tag:string;key:string;snapshot:Snapshot;program:Program}
export function generate(raw:unknown,m:Mission,vocabulary=VOCAB):Artifact{
  const snapshot=clone(raw) as Snapshot,p=parse(snapshot),key=identity(p,m.id),t=tag(key),cfg=p.tuning;
  if(!p.steps.length||p.steps.length>24)throw new Error('Build a route before uploading.');
  for(const n of Object.values(vocabulary))if(!/^[A-Za-z_]\w*$/.test(n))throw new Error('Invalid Python function identifier.');
  const v=vocabulary;
  const codes=p.steps.map(s=>['forward','left','right','deliver','park'].indexOf(s.action));
  const source=`import time
_pp_route = ${JSON.stringify(codes)}
_pp_run = ''
_pp_next = 0
_pp_busy = False
_pp_test = ''

def _pp_park():
  try:
    ${v.ls}(0)
  finally:
    ${v.rs}(0)

def _pp_action(code):
  try:
    if code == 0:
      ${v.lf}(${cfg.speed})
      ${v.rf}(${cfg.speed})
      time.sleep_ms(${cfg.forwardMs})
    elif code == 1:
      ${v.lb}(${cfg.speed})
      ${v.rf}(${cfg.speed})
      time.sleep_ms(${cfg.leftMs})
    elif code == 2:
      ${v.lf}(${cfg.speed})
      ${v.rb}(${cfg.speed})
      time.sleep_ms(${cfg.rightMs})
    elif code == 3:
      _pp_park()
      for _parcel_flash in range(2):
        ${v.on}()
        time.sleep_ms(100)
        ${v.off}()
        time.sleep_ms(100)
    elif code == 4:
      ${v.off}()

  finally:
    _pp_park()

def MQTT(mqtt_msg, voltage):
  global _pp_run, _pp_next, _pp_busy, _pp_test
  if mqtt_msg == 'stop':
    _pp_run = ''
    try:
      _pp_park()
    finally:
      ${v.off}()
    return 0
  if not isinstance(mqtt_msg, str):
    return 0
  # p2 + 8-char program tag + operation + 6-char nonce + 2-char index = 19 bytes.
  if len(mqtt_msg) != 19 or mqtt_msg[:2] != 'p2' or mqtt_msg[2:10] != '${t.slice(0,8)}':
    return 0
  op = mqtt_msg[10]
  token = mqtt_msg[11:17]
  if any(c not in '0123456789abcdef' for c in token):
    return 0
  try:
    index = int(mqtt_msg[17:19], 16)
  except ValueError:
    return 0
  if op == 'a':
    if _pp_busy or index != 0:
      return 0
    # Repeated arm must not rewind the route and allow a duplicate movement.
    if _pp_run == token:
      return 0
    _pp_run = token
    _pp_next = 0
    _pp_park()
    return 0
  if _pp_busy:
    return 0
  if op == 't':
    if _pp_run or mqtt_msg == _pp_test or index not in (0, 1, 2, 3):
      return 0
    _pp_test = mqtt_msg
    _pp_busy = True
    try:
      if index == 3:
        # Light-only callback check. Seeing the light is a user's observation, not telemetry.
        try:
          for _parcel_flash in range(2):
            ${v.on}()
            time.sleep_ms(150)
            ${v.off}()
            time.sleep_ms(150)
        finally:
          ${v.off}()
      else:
        _pp_action(index)
    finally:
      _pp_busy = False
    return 0
  if op != 's' or token != _pp_run or not _pp_run:
    return 0
  if index != _pp_next or index < 0 or index >= len(_pp_route):
    return 0
  _pp_next += 1
  _pp_busy = True
  try:
    _pp_action(_pp_route[index])
    if _pp_route[index] == 4:
      _pp_run = ''
  except Exception:
    _pp_run = ''
    raise
  finally:
    _pp_busy = False
`;
  if(source.includes('/n')||source.trimEnd().endsWith('/')||byteLength(source)>128*1024)throw new Error('Source cannot be represented by this firmware upload format.');
  return {source,tag:t,key,snapshot,program:p};
}
export function stepWait(action:Action,t:Tuning):number{return (action==='forward'?t.forwardMs:action==='left'?t.leftMs:action==='right'?t.rightMs:action==='deliver'?400:0)+500;}
export function registerBlocks(B:any):void{
  const statement={previousStatement:null,nextStatement:null,colour:164};
  B.defineBlocksWithJsonArray([
    {type:'parcel_program',message0:'My delivery route %1',args0:[{type:'input_statement',name:'DO'}],colour:220},
    {type:'parcel_forward',message0:'↑ move one square',...statement},
    {type:'parcel_left',message0:'↶ turn left',...statement,colour:275},
    {type:'parcel_right',message0:'↷ turn right',...statement,colour:275},
    {type:'parcel_deliver',message0:'🎁 deliver parcel',...statement,colour:30},
    {type:'parcel_park',message0:'🏁 park & finish',...statement,colour:340},
    {type:'parcel_repeat',message0:'repeat %1 times %2',args0:[{type:'field_number',name:'COUNT',value:2,min:2,max:4,precision:1},{type:'input_statement',name:'DO'}],...statement,colour:85}
  ]);
}
export function toolbox(m:Mission):object{
  const types=['parcel_forward'];if(m.id>1)types.push('parcel_left','parcel_right');types.push('parcel_deliver','parcel_park');if(m.id>2)types.push('parcel_repeat');
  return {kind:'flyoutToolbox',contents:types.map(type=>({kind:'block',type}))};
}
export interface Progress{schema:1;selected:number;cleared:boolean[];assisted:boolean[];deliveries:number[]}
export const freshProgress=():Progress=>({schema:1,selected:1,cleared:[false,false,false],assisted:[false,false,false],deliveries:[0,0,0]});
export function readProgress(raw:unknown):Progress{if(raw==null)return freshProgress();const p=raw as Progress;if(p.schema!==1)throw new Error('Newer progress version; existing data will not be overwritten.');const out=freshProgress();for(let i=0;i<3;i++){out.cleared[i]=p.cleared?.[i]===true&&(i===0||out.cleared[i-1]);out.assisted[i]=p.assisted?.[i]===true;out.deliveries[i]=Math.max(0,Math.min(MISSIONS[i].houses.length,Number(p.deliveries?.[i])||0));}out.selected=Math.min(Math.max(1,Math.floor(Number(p.selected)||1)),unlocked(out));return out;}
export const unlocked=(p:Progress):number=>p.cleared[0]?(p.cleared[1]?3:2):1;
