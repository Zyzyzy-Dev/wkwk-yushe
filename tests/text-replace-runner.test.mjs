// Worker client integration in Node threads with a browser message adapter; synthetic data only.
// This verifies lifecycle and off-thread execution, and does not substitute for rendered browser QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as ThreadWorker} from 'node:worker_threads';
import {getEventListeners} from 'node:events';
import {runReplacementTask} from '../src/features/preset/ui/text-replace-runner.js';

const stats = {created:0, active:0, terminated:0};
class BrowserWorker {
  constructor(url) {
    this.listeners = new Map();
    this.stopped = false;
    stats.created++; stats.active++;
    this.thread = new ThreadWorker(`
      const {parentPort}=require('node:worker_threads');
      globalThis.self={
        addEventListener(type,handler){if(type==='message')parentPort.on('message',data=>handler({data}));},
        postMessage(value){parentPort.postMessage(value);}
      };
      import(${JSON.stringify(url.href)}).catch(error=>{throw error});
    `, {eval:true});
    this.thread.on('message', data => this.emit('message', {data}));
    this.thread.on('messageerror', error => this.emit('messageerror', error));
    this.thread.on('error', error => this.emit('error', {message:error.message,preventDefault(){}}));
  }
  emit(type, event) { for (const fn of this.listeners.get(type) || []) fn(event); }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  postMessage(value) { this.thread.postMessage(value); }
  terminate() { if (!this.stopped) { this.stopped=true;stats.active--;stats.terminated++;this.thread.terminate(); } }
}
globalThis.Worker = BrowserWorker;
const entries = [{identifier:'a',name:'apple A',content:'apple APPLE\nnext apple'}, {identifier:'b',name:'banana B',content:'banana'}];
const trap = [{identifier:'a',name:'trap',content:'a'.repeat(25000)+'!'}];

test('real worker computes regex ranges, capture preview, and validated application', async () => {
  const input=structuredClone(entries),options={query:'/(?<word>apple)/gi',replacement:'<$<word>>',fields:['name','content'],regex:true};
  const controller=new AbortController();
  const view=await runReplacementTask('view',{context:{entries:input,groups:[{id:'g',name:'group',ids:['a','b']}]},options},{signal:controller.signal});
  assert.deepEqual(view.candidates.map(x=>x.id),['a']);
  assert.deepEqual(view.candidates[0].ranges.content,[[0,5],[6,11],[17,22]]);
  const preview=await runReplacementTask('preview',{entries:input,options},{signal:controller.signal});
  assert.ok(preview.afterById instanceof Map);
  assert.equal(preview.afterById.get('a').content,'<apple> <APPLE>\nnext <apple>');
  const applied=await runReplacementTask('apply',{entries:input,plan:preview.plan},{signal:controller.signal});
  assert.equal(applied.entries[0].content,preview.afterById.get('a').content);
  assert.equal(applied.entries[1].content,'banana');
  assert.deepEqual(input,entries,'worker never mutates input');
  assert.equal(stats.active,0);
  assert.equal(getEventListeners(controller.signal,'abort').length,0,'success removes abort listener');
});

test('worker rejects invalid pattern and tampered captures without applying', async () => {
  await assert.rejects(runReplacementTask('view',{context:{entries},options:{query:'[',regex:true}}),/正则|表达式/);
  const preview=await runReplacementTask('preview',{entries,options:{query:'(apple)',replacement:'<$1>',regex:true}});
  preview.plan.matches[0].replacement='tampered';
  await assert.rejects(runReplacementTask('apply',{entries,plan:preview.plan}),/替换内容无效/);
  assert.equal(stats.active,0);
  assert.equal(entries[0].content,'apple APPLE\nnext apple');
});

test('already aborted operation creates no worker', async () => {
  const before=stats.created,controller=new AbortController();controller.abort();
  await assert.rejects(runReplacementTask('view',{context:{entries},options:{}},{signal:controller.signal}),{name:'AbortError'});
  assert.equal(stats.created,before);
});

test('aborting an active catastrophic regex terminates thread and removes listener', async () => {
  const controller=new AbortController();
  const pending=runReplacementTask('view',{context:{entries:trap},options:{query:'(a+)+$',regex:true}},{signal:controller.signal});
  setTimeout(()=>controller.abort(),100);
  await assert.rejects(pending,{name:'AbortError'});
  assert.equal(stats.active,0);
  assert.equal(getEventListeners(controller.signal,'abort').length,0);
});

test('time budget ends a pathological regex while the main event loop stays responsive', async () => {
  let ticks=0;const ticker=setInterval(()=>ticks++,20),controller=new AbortController();
  try {
    await assert.rejects(runReplacementTask('view',{context:{entries:trap},options:{query:'(a+)+$',regex:true}},{signal:controller.signal,timeoutMs:500}),error=>error.code==='REPLACEMENT_TIMEOUT');
    assert.ok(ticks>0,'main thread continues running timers');
    assert.equal(stats.active,0);
    assert.equal(getEventListeners(controller.signal,'abort').length,0);
  } finally { clearInterval(ticker); }
});

test('independent task completes while a second worker is occupied, then cancellation terminates both', async () => {
  const controller=new AbortController();
  const bad=runReplacementTask('view',{context:{entries:trap},options:{query:'(a+)+$',regex:true}},{signal:controller.signal});
  const check=assert.rejects(bad,{name:'AbortError'});
  const good=await runReplacementTask('view',{context:{entries},options:{query:'banana',regex:true}});
  assert.deepEqual(good.candidates.map(x=>x.id),['b']);
  controller.abort();await check;assert.equal(stats.active,0);
});

test('unsupported Worker and uncloneable payload fail without fallback or a worker leak', async () => {
  const before=stats.created;
  delete globalThis.Worker;
  try { await assert.rejects(runReplacementTask('view',{context:{entries},options:{query:'apple',regex:true}}),/不支持后台正则/); }
  finally { globalThis.Worker=BrowserWorker; }
  assert.equal(stats.created,before);
  await assert.rejects(runReplacementTask('view',{context:{entries},uncloneable(){}}),{name:'DataCloneError'});
  assert.equal(stats.active,0);
  await assert.rejects(runReplacementTask('other',{}),/未知/);
});

test.after(()=>assert.equal(stats.active,0,'every worker is terminated'));
