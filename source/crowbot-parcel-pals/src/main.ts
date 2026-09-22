import {MODULE_ID,VERSION,BLOCK_SET,PROFILE,Snapshot,MISSIONS,Mission,Assessment,Progress,Artifact,Action,Tuning,DEFAULT_TUNING,blank,example,parse,evaluate,generate,registerBlocks,toolbox,clone,byteLength,tuning,readProgress,freshProgress,unlocked,ACTION_LABEL,ACTION_ICON,stepWait} from './model.js';
import {Link,SDK,Context,DataEvent,connectionKey,errorText,Off} from './device.js';
import {DeliveryRun,CommandGate} from './session.js';
import {renderBoard} from './board.js';
declare global{interface Window{icreator?:SDK;Blockly:any}}
const $=<T extends HTMLElement=HTMLElement>(id:string):T=>{const e=document.getElementById(id);if(!e)throw new Error('Missing interface element: '+id);return e as T;};
const B=window.Blockly;
let sdk:SDK|null=null,context:Context|null=null,link:Link|null=null;
let mission:Mission=MISSIONS[0],progress:Progress=freshProgress(),draft:Snapshot=blank(),assessment:Assessment=evaluate(draft,mission);
let student:any=null,sample:any=null,editorMission=0,loading=false,protectedDraft=false,progressWritable=true;
let blocksRegistered=false,gateKey='',runError='';
let screen='home',visible=true,hostVisible=true,disposed=false,initialized=false,busy=false,attention=false;
let receipt:{key:string;connection:string;tag:string}|null=null;
let run:DeliveryRun|null=null,gate:CommandGate|null=null,readCandidate:unknown=null,lastStateKey='',provenance='local-editor';
let saveTimer:ReturnType<typeof setTimeout>|null=null,saveChain:Promise<void>=Promise.resolve(),pulseEpoch=0,pulseTimer:ReturnType<typeof setTimeout>|null=null,pulseWake:(()=>void)|null=null;
let confirmAnswer:((value:boolean)=>void)|null=null,focusBefore:HTMLElement|null=null;
const off:Off[]=[],observers:ResizeObserver[]=[];
const keyDraft=(id=mission.id)=>`parcel.v1.stage.${id}`;
const listen=(target:EventTarget,name:string,fn:EventListener):void=>{target.addEventListener(name,fn);off.push(()=>target.removeEventListener(name,fn));};
function click(id:string,fn:()=>unknown):void{listen($(id),'click',()=>{void Promise.resolve().then(fn).catch(e=>failure(id,e));});}
function log(text:string,error=false):void{if(disposed)return;const el=document.createElement('div');el.textContent=text;el.className=error?'error':'';$('logs').append(el);while($('logs').children.length>100)$('logs').firstElementChild?.remove();}
function status(text:string):void{if(!disposed)$('status').textContent=text;}
function failure(operation:string,e:unknown):void{const msg=operation+': '+errorText(e);if(screen==='play')runError=msg;console.error(`[${MODULE_ID} ${VERSION}]`,operation,e);log(msg,true);status(msg);if(screen==='setup')$('uploadNotice').textContent=msg;if(screen==='play')$('runStatus').textContent=msg;}
function say(text:string):void{status(text);log(text);}
async function store(key:string,value:unknown):Promise<boolean>{
  if(!sdk){status('Open this module in iCreator to save your route.');return false;}
  try{if(byteLength(JSON.stringify(value))>240*1024)throw new Error('This backup is too large for project storage. It stays in this window.');await sdk.storage.set(key,value);return true;}
  catch(e){failure('Save '+key,e);$('saveState').textContent='Not saved — keep this window open';return false;}
}
function snapshot():Snapshot{return student&&editorMission===mission.id?B.serialization.workspaces.save(student):clone(draft);}
function metadata(reason:string):object{return {workspaceSchemaVersion:1,blockSetId:BLOCK_SET,blockSetVersion:VERSION,generatorVersion:VERSION,adapterId:'parcel-crowbot-esp32',adapterVersion:VERSION,expectedFirmwareVersion:null,timestamp:new Date().toISOString(),provenance:reason};}
async function saveDraft():Promise<boolean>{
  if(!initialized||protectedDraft||loading)return false;if(saveTimer){clearTimeout(saveTimer);saveTimer=null;}
  const saved=snapshot(),id=mission.id;draft=clone(saved);let ok=false;
  const work=saveChain.then(async()=>{ok=await store(keyDraft(id),saved);if(ok){await store(`parcel.v1.meta.${id}`,metadata(provenance));if(!disposed&&id===mission.id)$('saveState').textContent='Saved in this project';}});
  saveChain=work.catch(e=>failure('Draft save',e));await work;return ok;
}
function scheduleSave():void{if(saveTimer)clearTimeout(saveTimer);saveTimer=setTimeout(()=>void saveDraft(),450);}
async function backup(reason:string):Promise<void>{
  const saved=snapshot();if(!sdk)throw new Error('Project storage is unavailable. Your current blocks were not replaced.');
  if(!await store('parcel.v1.backup',saved))throw new Error('Could not back up your current route. Nothing was replaced.');await store('parcel.v1.backup.meta',{...metadata(reason),mission:mission.id});
}
async function ask(title:string,text:string,yes='Continue'):Promise<boolean>{
  confirmAnswer?.(false);focusBefore=document.activeElement as HTMLElement;$('modalTitle').textContent=title;$('modalText').textContent=text;$('modalYes').textContent=yes;$('modal').classList.remove('hidden');
  return new Promise(resolve=>{confirmAnswer=value=>{confirmAnswer=null;$('modal').classList.add('hidden');focusBefore?.focus();resolve(value);};$('modalNo').focus();});
}
function setScreen(next:string):void{
  if(disposed)return;screen=next;document.body.dataset.screen=next;
  ['home','brief','build','setup','play','result'].forEach(n=>$(n+'Screen').classList.toggle('hidden',n!==next));
  $('footer').classList.toggle('hidden',next==='play');
  if(next!=='play'&&document.fullscreenElement===$('playScreen'))void document.exitFullscreen().catch(e=>log('Fullscreen exit: '+errorText(e)));
  if(next!=='play')window.scrollTo({top:0,behavior:'instant'});
  if(next==='build')requestAnimationFrame(()=>resizeEditors());
  update();
}
function activeRun():boolean{return !!run&&['arming','ready','sending','observe'].includes(run.phase);}
function allowedUiChange():boolean{return !busy&&!link?.operation&&!activeRun()&&!gate?.busy;}
function checkNow():void{
  const raw=snapshot();assessment=evaluate(raw,mission);draft=clone(raw);
  if(receipt&&receipt.key!==assessment.key)receipt=null;
  $('feedback').textContent=assessment.message;$('checkTitle').textContent=assessment.ok?'That route works!':'One thing to try';$('check').closest('.checkBar')?.classList.toggle('good',assessment.ok);
  try{$('python').textContent=generate(raw,mission).source;}catch(e){$('python').textContent='# '+errorText(e);}
  const t=assessment.program.tuning;for(const k of ['speed','forwardMs','leftMs','rightMs'] as const)$(<string>k).setAttribute('data-saved',String(t[k]));
  if(!disposed)update();
}
function loadWorkspace(raw:Snapshot):void{
  loading=true;try{draft=clone(raw);if(student){B.serialization.workspaces.load(raw,student);editorMission=mission.id;}}finally{loading=false;}
  receipt=null;protectedDraft=false;checkNow();fillTuning();resizeEditors();
}
function resizeEditors():void{if(!student||screen!=='build')return;B.svgResize(student);B.svgResize(sample);}
async function ensureEditors():Promise<void>{
  if(!B?.serialization?.workspaces)throw new Error('Bundled Blockly could not load. Use the updated iCreator host and the complete release ZIP.');
  await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
  if(!student){
    if(!blocksRegistered){registerBlocks(B);blocksRegistered=true;}
    student=B.inject($('student'),{toolbox:toolbox(mission),renderer:'zelos',trashcan:true,sounds:false,media:'./assets/vendor/media/',move:{scrollbars:true,drag:true,wheel:true},zoom:{controls:true,wheel:true,startScale:.86,minScale:.4,maxScale:1.4},grid:{spacing:24,length:3,colour:'#c8dccc',snap:true}});
    sample=B.inject($('sample'),{readOnly:true,renderer:'zelos',sounds:false,media:'./assets/vendor/media/',move:{scrollbars:true,drag:true,wheel:true},zoom:{controls:true,wheel:true,startScale:.73,minScale:.3,maxScale:1.3}});
    student.addChangeListener((event:any)=>{if(loading||disposed||event.isUiEvent||editorMission!==mission.id)return;provenance='local-editor';$('codeLabel').textContent='Generated from your route and wheel settings.';checkNow();if(!protectedDraft)scheduleSave();});
    for(const host of [$('student'),$('sample')]){const o=new ResizeObserver(()=>resizeEditors());o.observe(host);observers.push(o);}
  }
  if(editorMission!==mission.id){loading=true;try{student.updateToolbox(toolbox(mission));B.serialization.workspaces.load(draft,student);B.serialization.workspaces.load(example(mission),sample);editorMission=mission.id;}finally{loading=false;}}
  resizeEditors();requestAnimationFrame(()=>{if(screen==='build'){sample.zoomToFit();student.scrollCenter();}});checkNow();
}
function paintMission():void{
  $('briefSkill').textContent='DELIVERY '+mission.id+' · '+mission.skill;$('briefTitle').textContent=mission.title;
  $('briefStory').textContent=mission.houses.length===1?`${mission.houses[0].name} is waiting for ${mission.houses[0].parcel}. Can you help Bolt find the way?`:'Milo and Olive both have a parcel waiting. Find the repeating pattern and visit them in order.';
  $('buildSkill').textContent=mission.skill;$('buildTitle').textContent=mission.title;$('hintText').textContent=mission.hint;
  renderBoard($('briefBoard'),mission);renderBoard($('buildBoard'),mission);renderBoard($('setupBoard'),mission);fillTuning();renderCards();
}
function renderCards():void{
  $('missionCards').replaceChildren();$('progressText').textContent=`${progress.cleared.filter(Boolean).length} / 3 delivered`;
  for(const m of MISSIONS){const b=document.createElement('button');b.className='missionCard';b.disabled=m.id>unlocked(progress)||!initialized;
    const num=document.createElement('span');num.className='missionNumber';num.textContent='DELIVERY 0'+m.id;
    const icon=document.createElement('span');icon.className='missionEmoji';icon.textContent=m.icon;
    const name=document.createElement('b');name.textContent=m.title;const sub=document.createElement('small');sub.textContent=m.skill;
    const state=document.createElement('small');state.className='missionState';state.textContent=progress.cleared[m.id-1]?'✓ Delivered · play again':b.disabled?'🔒 Finish the previous delivery':'Build this route →';b.append(num,icon,name,sub,state);
    b.addEventListener('click',()=>void selectMission(m.id).catch(e=>failure('Choose mission',e)));$('missionCards').append(b);
  }
}
async function selectMission(id:number):Promise<void>{
  if(!allowedUiChange())throw new Error('Finish the robot operation first.');if(id>unlocked(progress))throw new Error('Deliver the previous parcel first.');
  await saveDraft();mission=MISSIONS[id-1];progress.selected=id;receipt=null;run=null;readCandidate=null;editorMission=0;protectedDraft=false;
  let raw:unknown=null;if(sdk){try{raw=await sdk.storage.get(keyDraft());}catch(e){protectedDraft=true;failure('Load route',e);}}
  if(raw){try{parse(raw);draft=clone(raw) as Snapshot;}catch(e){protectedDraft=true;draft=blank();failure('Saved route left untouched',e);}}else draft=blank();
  if(progressWritable)await store('parcel.v1.progress',progress);paintMission();assessment=evaluate(draft,mission);setScreen('brief');
}
function matches():boolean{return !!receipt&&assessment.ok&&receipt.key===assessment.key&&receipt.connection===connectionKey(link?.state??null);}
function canHardware():boolean{return !!link&&visible&&!disposed&&link.state?.currentDevice?.profileId===PROFILE;}
function update():void{
  if(disposed)return;const current=link?.state?.currentDevice;const op=!!link?.operation,sharedBusy=!!link?.state?.activity,move=activeRun();
  $('connection').textContent=current?`${current.name} · ${sharedBusy?'busy':'connected'}`:'Not connected';$('connection').classList.toggle('connected',!!current);
  const set=(id:string,yes:boolean)=>$(id).toggleAttribute('disabled',!yes);
  set('begin',initialized);set('home',initialized&&!busy&&!op&&!move&&!gate?.busy);set('save',initialized&&!!sdk&&!busy&&!move&&!protectedDraft);
  for(const id of ['buildBack','setupBack','briefBack','reset','copyExample','restoreBackup','applyTuning'])set(id,!busy&&!op&&!move&&!gate?.busy);
  set('toSetup',assessment.ok&&!protectedDraft&&!busy&&!op);set('check',!busy&&!op);
  set('connect',!!link&&!busy&&!op&&!current);set('disconnect',canHardware()&&!busy&&!op&&!move&&!sharedBusy);
  set('upload',canHardware()&&assessment.ok&&!protectedDraft&&!busy&&!op&&!sharedBusy&&!move&&!gate?.busy);
  set('cancelUpload',!!link?.job);$('cancelUpload').classList.toggle('hidden',!link?.job);
  const ready=matches()&&canHardware()&&!busy&&!op&&!sharedBusy&&!attention&&!gate?.busy;
  set('start',ready&&$<HTMLInputElement>('floorReady').checked&&$<HTMLInputElement>('startReady').checked);
  for(const id of ['testForward','testLeft','testRight'])set(id,ready&&$<HTMLInputElement>('floorReady').checked);
  set('toolStop',canHardware()&&!op);set('emergencyStop',canHardware()&&!op);set('read',canHardware()&&!op&&!busy&&!move&&!sharedBusy&&!gate?.busy);
  $('cancelRead').classList.toggle('hidden',link?.operation!=='read');
  if(screen==='setup'&&!busy){
    $('uploadNotice').textContent=attention?'Attend to Bolt. Send STOP before starting another run.':!current?'Connect your Crowbot. Your blocks never move it on their own.':sharedBusy?'The shared robot is busy in another operation.':!assessment.ok?'Go back and finish a valid route.':matches()?'Route upload acknowledged. Test your floor scale, reset to START, then begin.':'Upload this route and wheel settings before playing. This replaces the current device program.';
  }
  $('deviceInfo').textContent=link?`Profile: ${current?.profileId??'none'} · ${link.operation||'idle'} · module ${MODULE_ID} v${VERSION}`:'Open this module in iCreator for device operations.';
  if(screen==='play')paintRun();
}
function currentTuning():Tuning{try{const root=snapshot().blocks.blocks.find(b=>b.type==='parcel_program');return root?.data?tuning(JSON.parse(root.data)):clone(DEFAULT_TUNING);}catch{return clone(DEFAULT_TUNING);}}
function fillTuning():void{const t=currentTuning();for(const k of ['speed','forwardMs','leftMs','rightMs'] as const)$<HTMLInputElement>(k).value=String(t[k]);}
async function applyTuning():Promise<void>{
  if(!allowedUiChange())return;const t=tuning({schema:1,speed:Number($<HTMLInputElement>('speed').value),forwardMs:Number($<HTMLInputElement>('forwardMs').value),leftMs:Number($<HTMLInputElement>('leftMs').value),rightMs:Number($<HTMLInputElement>('rightMs').value)});
  if(student)student.getTopBlocks(false).find((b:any)=>b.type==='parcel_program').data=JSON.stringify(t);else draft.blocks.blocks[0].data=JSON.stringify(t);
  receipt=null;$<HTMLInputElement>('startReady').checked=false;checkNow();await saveDraft();$('testStatus').textContent='New timing saved in your blocks. Upload it, then test again.';update();
}
async function upload():Promise<void>{
  if(!link||busy||!assessment.ok)return;
  const artifact=generate(snapshot(),mission),expected=connectionKey(link.state);receipt=null;busy=true;attention=false;$('uploadProgress').setAttribute('value','0');$('uploadNotice').textContent='Sending the exact route and matching blocks. Keep the host open…';update();
  try{
    await saveDraft();const result=await link.upload(artifact.snapshot,artifact.source,expected,(text,p)=>{if(!disposed){$('uploadProgress').setAttribute('value',String(p));$('uploadNotice').textContent=text;}});
    if(result!=='device-confirmed')throw new Error('The host did not report device confirmation. Upload again explicitly before playing.');
    if(!visible||disposed||expected!==connectionKey(link.state)||artifact.key!==assessment.key)throw new Error('The route, connection or visible session changed. A new upload is required.');
    receipt={key:artifact.key,connection:expected,tag:artifact.tag};$('uploadProgress').setAttribute('value','100');
    await store(`parcel.v1.upload.${mission.id}`,{...metadata('uploaded-to-device'),key:artifact.key,tag:artifact.tag,confirmation:result});
    say('The host acknowledged upload. Test the real robot; no movement or position was verified by this app.');
  }catch(e){attention=true;failure('Upload: device state may be partial',e);}finally{busy=false;update();}
}
function newGate(expected:string):CommandGate{
  if(!link)throw new Error('Connect your Crowbot first.');
  gateKey=expected;return new CommandGate(text=>link!.send(text,expected),()=>visible&&!disposed&&!!link&&connectionKey(link.state)===expected);
}
const nonce=():string=>Array.from(crypto.getRandomValues(new Uint8Array(8)),n=>n.toString(16).padStart(2,'0')).join('');
async function testPulse(action:'forward'|'left'|'right'):Promise<void>{
  if(!matches()||!canHardware()||busy||!$<HTMLInputElement>('floorReady').checked)throw new Error('Upload these settings and confirm the clear-floor supervision first.');
  const artifact=generate(snapshot(),mission),expected=receipt!.connection,e=++pulseEpoch;gate=newGate(expected);busy=true;update();
  try{
    const code=['forward','left','right'].indexOf(action);$('testStatus').textContent='Watch Bolt. One bounded test action is being sent…';
    await gate.send(`pp:${artifact.tag}:test:${code}:${nonce()}`);
    if(e!==pulseEpoch||!visible)return;
    await new Promise<void>(resolve=>{pulseWake=resolve;pulseTimer=setTimeout(resolve,stepWait(action,artifact.program.tuning));});
    if(e===pulseEpoch&&visible)$('testStatus').textContent='Test command sent. Did the real move fit one square / a quarter-turn? Adjust, upload, and test again if needed.';
  }catch(e){attention=true;receipt=null;failure('Robot test',e);}finally{if(pulseTimer)clearTimeout(pulseTimer);pulseTimer=null;pulseWake=null;busy=false;update();}
}
async function startRun():Promise<void>{
  if(!matches()||!canHardware()||busy||attention||!$<HTMLInputElement>('floorReady').checked||!$<HTMLInputElement>('startReady').checked)throw new Error('Build, upload, test your floor scale, and reset Bolt to START first.');
  const artifact=generate(snapshot(),mission);await link!.current(receipt!.connection);
  runError='';gate=newGate(receipt!.connection);run=new DeliveryRun(artifact,gate,()=>paintRun(),()=>visible&&!disposed&&matches());
  setScreen('play');$('playMission').textContent='DELIVERY '+mission.id+' · '+mission.title;
  try{await run.begin(nonce());}catch(e){attention=true;receipt=null;failure('Start delivery',e);update();}
}
function paintRun():void{
  if(!run||screen!=='play'||disposed)return;const i=run.confirmed,p=run.artifact.program,step=p.steps[i],phase=run.phase;
  const previous=i>0?assessment.trace[i-1]:null,next=assessment.trace[i];
  renderBoard($('playBoard'),mission,{position:previous?.position??mission.start,delivered:previous?.delivered??0,ghost:['sending','observe','ready'].includes(phase)?next?.position:undefined});
  $('stepStrip').replaceChildren();p.steps.forEach((s,n)=>{const el=document.createElement('span');el.className='stepChip'+(n<i?' done':n===i?' current':'');el.textContent=ACTION_ICON[s.action];el.title=ACTION_LABEL[s.action];$('stepStrip').append(el);});
  $('stepNumber').textContent=`STEP ${Math.min(i+1,p.steps.length)} OF ${p.steps.length}`;
  $('actionIcon').textContent=step?ACTION_ICON[step.action]:'✓';$('actionTitle').textContent=step?ACTION_LABEL[step.action]:'All steps observed';
  const action=step?.action,coord=next?String.fromCharCode(65+next.position.x)+(next.position.y+1):'';
  $('actionText').textContent=action==='forward'?`Bolt plans to reach ${coord}. Watch the real wheels, not just the map.`:action==='left'||action==='right'?'Bolt will turn in place. Check its heading against the dashed arrow.':action==='deliver'?`Help place the parcel at ${mission.houses[next?.delivered?next.delivered-1:0]?.name??'your friend'}’s house. The robot will flash its delivery signal.`:'Bolt parks at the end of your route.';
  $('drive').toggleAttribute('disabled',phase!=='ready'||busy);$('drive').classList.toggle('hidden',phase==='observe');$('observe').classList.toggle('hidden',phase!=='observe');
  $('observeQuestion').textContent=action==='deliver'?'Did you see the light signal and place the parcel at the house?':action==='park'?'Are the real wheels stopped and the light off?':action==='forward'?`Did Bolt reach ${coord} and stop?`:'Did Bolt turn to face the dashed arrow and stop?';
  $('confirmStep').textContent=action==='deliver'?'Parcel delivered — I saw it ✓':'Yes, I saw it ✓';
  $('runStatus').textContent=phase==='arming'?'Preparing a fresh route session — no motion yet.':phase==='sending'?'Command sent or sending. Wait, then check the real robot.':phase==='observe'?'Your observation is needed. We cannot sense Bolt’s position.':phase==='aborted'?(runError||'Delivery paused/ended. Attend to Bolt, then return to setup.'):phase==='done'?'Finishing your delivery…':'You choose when the next physical action starts.';
}
async function drive():Promise<void>{if(!run)return;try{await run.step();}catch(e){attention=true;receipt=null;failure('Drive step',e);update();}}
async function confirmStep():Promise<void>{
  if(!run)return;run.confirm();if(run.phase!=='done')return;
  busy=true;update();try{
    const finishedRun=run;const stopped=await gate!.stop();if(!stopped)throw new Error('Finish STOP could not be sent. Attend to Bolt before continuing.');
    if(disposed||!visible||run!==finishedRun||finishedRun.phase!=='done'||!matches())throw new Error('The visible delivery session changed before saving. Check Bolt and restart from setup.');
    progress.cleared[mission.id-1]=true;progress.deliveries[mission.id-1]=mission.houses.length;
    if(progressWritable)await store('parcel.v1.progress',progress);
    await store(`parcel.v1.observed.${mission.id}`,{completedAt:new Date().toISOString(),confirmation:'user-observed',steps:run.confirmed,assisted:progress.assisted[mission.id-1]});
    $('resultTitle').textContent=mission.houses.length===1?`${mission.houses[0].name}’s parcel is here!`:'Two friends. Two happy deliveries!';
    $('resultText').textContent='You made a plan, programmed real wheels, and checked what happened. That’s a robot engineer’s delivery!';
    $('resultFriends').replaceChildren();mission.houses.forEach(h=>{const s=document.createElement('div');s.className='friendStamp';s.textContent=h.emoji;const name=document.createElement('small');name.textContent=h.name+' · delivered';s.append(name);$('resultFriends').append(s);});
    $('nextMission').textContent=mission.id<3?'Next delivery →':'Back to our neighborhood →';setScreen('result');renderCards();
  }catch(e){attention=true;receipt=null;failure('Finish delivery',e);}finally{busy=false;update();}
}
async function stopRobot():Promise<boolean>{
  if(!canHardware())throw new Error('Cannot send STOP while hidden or disconnected. Use the physical power switch if needed.');
  if(link!.operation)throw new Error('Finish/cancel the device transfer first; STOP cannot preempt the host transfer lock.');
  pulseEpoch++;pulseWake?.();run?.cancel();
  const expected=connectionKey(link!.state);if(!gate||gateKey!==expected){gate?.cancel();gate=newGate(expected);}
  try{const ok=await gate.stop();attention=!ok;if(!ok)throw new Error('STOP was not sent. Use the device power switch if it is moving.');runError='';say('STOP sent — inspect the real wheels. No physical stop acknowledgement exists.');return true;}
  catch(e){attention=true;receipt=null;failure('STOP — retry explicitly or use physical power',e);return false;}finally{update();}
}
async function leaveRun(adjust=false):Promise<void>{
  if(activeRun()&&!adjust&&!await ask('Finish this delivery?','Bolt will be asked to stop. Restart this route from the floor START marker next time.','Stop and leave'))return;
  const ok=await stopRobot();if(!ok)return;
  run=null;$<HTMLInputElement>('startReady').checked=false;setScreen('setup');
  if(adjust){$('tuningPanel').setAttribute('open','');$('testStatus').textContent='Great observing! Check forward/turn timing, upload any changes, then reset Bolt to START. Never correct a mismatch by assuming the map tracked it.';}
}
async function readDevice():Promise<void>{
  if(!link||busy||activeRun())throw new Error('Finish the delivery first.');busy=true;receipt=null;readCandidate=null;update();
  try{
    const data=await link.read();readCandidate=data.workspace;await store('parcel.v1.readback.raw',data.raw);await store('parcel.v1.readback.meta',metadata('device-readback'));
    let temp:any=null;try{parse(data.workspace);if(!blocksRegistered){registerBlocks(B);blocksRegistered=true;}temp=new B.Workspace();B.serialization.workspaces.load(data.workspace,temp);}finally{temp?.dispose();}
    $('readInfo').textContent=`${data.bytes} bytes received through device notifications. These are editable route blocks, not downloaded Python. Replace your current route?`;$('readResult').classList.remove('hidden');
  }catch(e){failure('Read blocks; current route kept',e);if(readCandidate)$('readInfo').textContent='Incompatible block set. Raw data retained; use the original module to edit it.';}finally{busy=false;update();}
}
async function replaceRead():Promise<void>{
  if(!readCandidate)return;if(!await ask('Use the recovered route?','Your current route will be backed up. The recovered blocks still need to be checked and uploaded for this mission.','Use recovered route'))return;
  parse(readCandidate);await backup('before-device-readback');loadWorkspace(clone(readCandidate) as Snapshot);provenance='device-readback';$('codeLabel').textContent='Generated from recovered blocks — not device source';await saveDraft();$('readResult').classList.add('hidden');$('tools').classList.add('hidden');setScreen('build');await ensureEditors();
}
function onData(e:DataEvent):void{if($<HTMLInputElement>('showHex').checked)$('hex').textContent=e.data.slice(0,180).map(x=>x.toString(16).padStart(2,'0')).join(' ');}
function linkChanged():void{
  if(!link||disposed)return;const k=connectionKey(link.state),a=link.state?.activity;
  const own=a?.owner.type==='module'&&(a.owner.id===context?.module.id||a.owner.id===context?.module.instanceId);
  if((lastStateKey&&k!==lastStateKey)||(a?.kind==='upload'&&!own)){
    receipt=null;if(activeRun()){run!.cancel();attention=true;}say('The robot connection/program changed. Upload your route again.');
  }
  if(activeRun()&&a&&!own){run!.cancel();receipt=null;attention=true;say('Another client used the robot. The delivery ended; check Bolt and upload again.');}
  lastStateKey=k;update();
}
function visibilityChanged():void{
  visible=hostVisible&&!document.hidden;link?.setVisible(visible);
  if(!visible){confirmAnswer?.(false);if(activeRun()||busy||gate?.busy){run?.cancel();gate?.cancel();pulseEpoch++;pulseWake?.();attention=true;receipt=null;status('The module was hidden. Check Bolt, send STOP on return, and upload again.');}}
  update();
}
function bind():void{
  click('begin',()=>selectMission(progress.selected));click('home',async()=>{if(allowedUiChange()){await saveDraft();setScreen('home');renderCards();}});
  click('briefBack',()=>setScreen('home'));click('build',async()=>{setScreen('build');await ensureEditors();});click('buildBack',()=>setScreen('brief'));click('setupBack',async()=>{setScreen('build');await ensureEditors();});
  click('save',async()=>{if(await saveDraft())say('Your delivery route is saved.');});click('check',()=>checkNow());
  click('fitStudent',()=>{resizeEditors();student?.zoomToFit();});click('fitExample',()=>{resizeEditors();sample?.zoomToFit();});
  click('tabStudent',()=>{$('workshop').dataset.tab='student';$('tabStudent').classList.add('selected');$('tabExample').classList.remove('selected');resizeEditors();});
  click('tabExample',()=>{$('workshop').dataset.tab='example';$('tabExample').classList.add('selected');$('tabStudent').classList.remove('selected');resizeEditors();sample?.zoomToFit();});
  click('reset',async()=>{if(await ask('Make a fresh route?','We’ll keep a backup before clearing your route. Robot timing settings will stay.','Start fresh')){await backup('before-reset');loadWorkspace(blank(currentTuning()));await saveDraft();}});
  click('copyExample',async()=>{if(await ask('Use the finished example?','Try building it first. This rescue option backs up your work and records that you used a hint. You must still upload and drive the real route.','Use this example')){await backup('before-example');const t=currentTuning();loadWorkspace(example(mission,t));progress.assisted[mission.id-1]=true;if(progressWritable)await store('parcel.v1.progress',progress);await saveDraft();}});
  click('restoreBackup',async()=>{const raw=await sdk?.storage.get('parcel.v1.backup');if(!raw)throw new Error('No local backup yet.');parse(raw);if(await ask('Restore your local backup?','This is saved local work, not a new device read.','Restore backup')){loadWorkspace(raw as Snapshot);provenance='local-backup';await saveDraft();}});
  click('toSetup',async()=>{checkNow();if(assessment.ok){await saveDraft();renderBoard($('setupBoard'),mission);fillTuning();$<HTMLInputElement>('startReady').checked=false;setScreen('setup');}});
  click('connect',async()=>{await link?.connect();update();});click('upload',upload);click('start',startRun);click('applyTuning',applyTuning);
  for(const [id,action] of [['testForward','forward'],['testLeft','left'],['testRight','right']] as const)click(id,()=>testPulse(action));
  listen($('floorReady'),'change',()=>update());listen($('startReady'),'change',()=>update());
  click('drive',drive);click('confirmStep',confirmStep);click('notThere',()=>leaveRun(true));click('exitPlay',()=>leaveRun());click('emergencyStop',()=>stopRobot());click('toolStop',()=>stopRobot());
  click('fullscreen',async()=>{try{if(document.fullscreenElement=== $('playScreen'))await document.exitFullscreen();else await $('playScreen').requestFullscreen();}catch(e){say('Native fullscreen is unavailable; the delivery view still fills this module window.');}});
  click('nextMission',()=>mission.id<3?selectMission(mission.id+1):setScreen('home'));click('resultHome',()=>{renderCards();setScreen('home');});
  click('toolsOpen',()=>{$('tools').classList.remove('hidden');$('toolsClose').focus();});click('toolsClose',()=>{$('tools').classList.add('hidden');$('toolsOpen').focus();});
  click('disconnect',async()=>{await link?.disconnect();receipt=null;gate=null;update();});click('read',readDevice);click('replaceRead',replaceRead);click('keepRead',()=>{$('readResult').classList.add('hidden');readCandidate=null;});
  click('cancelRead',()=>link?.cancelRead());click('cancelUpload',async()=>{if(await ask('Cancel the device upload?','The host will disconnect the shared robot. Some blocks/code may already have changed. Cancellation is not rollback.','Cancel and disconnect'))await link?.cancelUpload();});
  click('modalYes',()=>confirmAnswer?.(true));click('modalNo',()=>confirmAnswer?.(false));
  listen(document,'keydown',((e:KeyboardEvent)=>{if(!$('modal').classList.contains('hidden')){if(e.key==='Escape'){e.preventDefault();confirmAnswer?.(false);}if(e.key==='Tab'){const first=$('modalNo'),last=$('modalYes');if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}}) as EventListener);
  listen(document,'visibilitychange',()=>visibilityChanged());listen(window,'pagehide',()=>dispose());
}
function dispose():void{if(disposed)return;disposed=true;visible=false;confirmAnswer?.(false);run?.cancel();gate?.cancel();if(saveTimer)clearTimeout(saveTimer);if(pulseTimer)clearTimeout(pulseTimer);pulseWake?.();link?.dispose();off.splice(0).forEach(fn=>fn());observers.splice(0).forEach(o=>o.disconnect());student?.dispose();sample?.dispose();}
async function init():Promise<void>{
  bind();paintMission();
  try{
    if(!window.icreator){$('sdkWarning').textContent='Open this module in iCreator. You can explore the lessons here; real robot play and project saving need the host.';$('sdkWarning').classList.remove('hidden');}
    else{
      context=await window.icreator.ready();sdk=window.icreator;
      if(!context.capabilities?.device?.available){$('sdkWarning').textContent=context.capabilities?.device?.unavailableReason??'Bluetooth is unavailable in this host.';$('sdkWarning').classList.remove('hidden');}
      else{link=new Link(sdk,context,linkChanged,log,onData);try{await link.init();}catch(e){link.dispose();link=null;throw e;}}
      const offVisible=sdk.lifecycle.onVisibilityChange(v=>{hostVisible=v;visibilityChanged();});if(offVisible)off.push(offVisible);const offDispose=sdk.lifecycle.onDispose(dispose);if(offDispose)off.push(offDispose);
      try{progress=readProgress(await sdk.storage.get('parcel.v1.progress'));}catch(e){progressWritable=false;failure('Saved progress kept unchanged',e);}
    }
  }catch(e){failure('Initialize iCreator',e);$('sdkWarning').textContent='iCreator initialization: '+errorText(e)+'. Reopen the module to retry.';$('sdkWarning').classList.remove('hidden');}
  initialized=true;renderCards();if(progressWritable)status('Choose a delivery. Your real robot is the hero.');update();console.info(`[${MODULE_ID} ${VERSION}] ready; hardware actions require explicit input.`);
}
void init().catch(e=>failure('Startup',e));
