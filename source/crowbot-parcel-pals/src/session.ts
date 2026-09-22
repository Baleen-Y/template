import {Artifact, Action, stepWait} from './model.js';
import {runtimeCommand} from './runtime.js';
/** Cancellation before a write is distinguishable from an uncertain device failure. */
export class CanceledCommandError extends Error {}
/** No command backlog. STOP invalidates any selected command still waiting for its rate slot. */
export class CommandGate {
  private flight:Promise<void>|null=null;private epoch=0;private last=-Infinity;private pendingStop:Promise<boolean>|null=null;
  private wake:(()=>void)|null=null;private timer:ReturnType<typeof setTimeout>|null=null;
  constructor(private write:(text:string)=>Promise<void>,private active:()=>boolean,private interval=160){}
  get busy():boolean{return !!this.flight||!!this.pendingStop;}
  private async delay(ms:number):Promise<void>{if(ms<=0)return;await new Promise<void>(resolve=>{this.wake=resolve;this.timer=setTimeout(resolve,ms);});if(this.timer)clearTimeout(this.timer);this.timer=null;this.wake=null;}
  private async transmit(text:string,e:number):Promise<void>{
    await Promise.resolve();await this.delay(Math.max(0,this.interval-(performance.now()-this.last)));
    if(e!==this.epoch||!this.active())throw new CanceledCommandError('This command was canceled before sending.');
    this.last=performance.now();await this.write(text);
  }
  async send(text:string):Promise<void>{
    if(this.busy)throw new Error('One step at a time. The previous action has not finished.');
    const p=this.transmit(text,this.epoch);this.flight=p;
    try{await p;}finally{if(this.flight===p)this.flight=null;}
  }
  stop():Promise<boolean>{
    if(this.pendingStop)return this.pendingStop;
    this.epoch++;const e=this.epoch;this.wake?.();const old=this.flight;
    const task=(async()=>{try{await old;}catch{/* An invalidated ordinary command is never replayed. */}
      if(!this.active())return false;
      try{const p=this.transmit('stop',e);this.flight=p;await p;return true;}finally{this.flight=null;}
    })();
    this.pendingStop=task;
    void task.finally(()=>{if(this.pendingStop===task)this.pendingStop=null;}).catch(()=>undefined);
    return task;
  }
  cancel():void{this.epoch++;this.wake?.();}
}
export type Phase='idle'|'arming'|'ready'|'sending'|'observe'|'done'|'aborted';
export class DeliveryRun {
  readonly mode = 'guided';
  phase:Phase='idle';confirmed=0;runId='';private epoch=0;private timer:ReturnType<typeof setTimeout>|null=null;private wake:(()=>void)|null=null;
  constructor(readonly artifact:Artifact,readonly gate:CommandGate,private changed:()=>void,private active:()=>boolean,private timing=(a:Action)=>stepWait(a,artifact.program.tuning)){}
  private set(p:Phase):void{this.phase=p;this.changed();}
  async begin(runId:string):Promise<void>{
    if(this.phase!=='idle')throw new Error('Start a fresh run from the launch page.');
    if(!/^[a-f0-9]{6}$/.test(runId))throw new Error('Invalid run identifier.');
    this.runId=runId;this.confirmed=0;const e=++this.epoch;this.set('arming');
    try{await this.gate.send(runtimeCommand(this.artifact.tag,'a',runId));if(e===this.epoch&&this.active())this.set('ready');}
    catch(err){if(e===this.epoch)this.set('aborted');throw err;}
  }
  async step():Promise<void>{
    if(this.phase!=='ready'||!this.active())throw new Error('Look at Bolt and confirm the previous step first.');
    const i=this.confirmed,e=this.epoch,step=this.artifact.program.steps[i];if(!step)throw new Error('No route step remains.');
    this.set('sending');
    try{
      await this.gate.send(runtimeCommand(this.artifact.tag,'s',this.runId,i));
      if(e!==this.epoch||!this.active())return;
      await new Promise<void>(resolve=>{this.wake=resolve;this.timer=setTimeout(resolve,this.timing(step.action));});
      if(this.timer)clearTimeout(this.timer);this.timer=null;this.wake=null;
      // This is only a conservative UI wait. No step-execution acknowledgement exists.
      if(e===this.epoch&&this.active())this.set('observe');
    }catch(err){if(e===this.epoch)this.set('aborted');throw err;}
  }
  confirm():void{
    if(this.phase!=='observe'||!this.active())throw new Error('An observation is needed after a sent step.');
    this.confirmed++;this.set(this.confirmed===this.artifact.program.steps.length?'done':'ready');
  }
  cancel():void{this.epoch++;if(this.timer)clearTimeout(this.timer);this.timer=null;this.wake?.();this.wake=null;this.gate.cancel();this.set('aborted');}
  async stop():Promise<boolean>{this.cancel();return this.gate.stop();}
}
