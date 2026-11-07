// 工作台慢保存回归：写前/写后超时、总等待预算、草稿提示与诊断分类。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkbenchSaveIO} from '../src/host/worldbook-persistence.js';
import {createDiagnosticLog, formatDiagnosticReport} from '../src/shared/diagnostics.js';

const env = {script:{getRequestHeaders:() => ({'Content-Type':'application/json'})}};
const flush = async () => {for (let i=0;i<12;i++) await Promise.resolve();};
function fixture(t, delay, response = {world_names:['Book']}) {
  t.mock.timers.enable({apis:['setTimeout','Date'], now:0});
  const calls=[];
  t.mock.method(globalThis,'fetch', (url, options) => {
    calls.push({url,body:JSON.parse(options.body)});
    return new Promise((resolve,reject) => {
      const timer=setTimeout(() => resolve({ok:true,json:async()=>response,arrayBuffer:async()=>new ArrayBuffer(0)}),delay);
      options.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('The user aborted a request.','AbortError'));},{once:true});
    });
  });
  return {io:createWorkbenchSaveIO(env),calls,async tick(ms){t.mock.timers.tick(ms);await flush();}};
}

test('save directory check tolerates 12 seconds and clears its timeout after success', async t => {
  const f=fixture(t,12000), pending=f.io.names();
  await f.tick(8000);assert.equal(f.io.writeAttempted,false);
  await f.tick(4000);assert.deepEqual(await pending,['Book']);
  await f.tick(60000);assert.equal(f.calls.length,1);
});
test('preflight timeout is explicit and sends no write', async t => {
  const f=fixture(t,60000);
  const pending=assert.rejects(f.io.names(), error => error.name==='TimeoutError' && /保存前世界书列表检查超时.*尚未发送保存请求.*草稿已保留/.test(error.message));
  await f.tick(45000);await pending;
  assert.equal(f.io.writeAttempted,false);assert.deepEqual(f.calls.map(c=>c.url),['/api/settings/get']);
});
test('write timeout says result is unknown and never repeats the POST', async t => {
  const f=fixture(t,60000);
  const pending=assert.rejects(f.io.write('/api/worldinfo/edit',{data:{entries:{}}},'世界书写入'), error => error.name==='TimeoutError' && /世界书写入超时.*请求已发出.*尚未确认/.test(error.message));
  await f.tick(45000);await pending;await f.tick(60000);
  assert.equal(f.io.writeAttempted,true);assert.equal(f.calls.length,1);
});
test('successful write followed by slow readback keeps unknown result wording', async t => {
  const f=fixture(t,60000);
  t.mock.method(globalThis,'fetch',async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(0)}));
  await f.io.write('/api/worldinfo/edit',{},'世界书写入');
  t.mock.method(globalThis,'fetch',(_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('abort','AbortError')),{once:true})));
  const pending=assert.rejects(f.io.read('/api/worldinfo/get',{},'世界书保存后核验'),error=>error.name==='TimeoutError' && /保存后核验超时.*尚未确认.*勿直接重复保存/.test(error.message));
  await f.tick(45000);await pending;assert.equal(f.io.writeAttempted,true);
});
test('slow sequential calls share the budget and an expired budget cannot send a write', async t => {
  const f=fixture(t,35000);
  for(let i=0;i<3;i++){const p=f.io.names();await f.tick(35000);await p;}
  const last=assert.rejects(f.io.names(),{name:'TimeoutError'});await f.tick(15000);await last;
  await assert.rejects(f.io.write('/api/worldinfo/edit',{},'世界书写入'),/等待时间已用完.*尚未发送保存请求/);
  assert.equal(f.calls.length,4);assert.equal(f.io.writeAttempted,false);
});
test('timeouts include response body reading, not just response headers',async t=>{
  const f=fixture(t,0);
  t.mock.method(globalThis,'fetch',async(_url,options)=>({ok:true,json:()=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('abort','AbortError')),{once:true}))}));
  const pending=assert.rejects(f.io.names(),{name:'TimeoutError'});await flush();await f.tick(45000);await pending;
});
test('external interruption and HTTP errors have phase labels without exposing raw exception text',async t=>{
  t.mock.method(globalThis,'fetch',async()=>{throw new DOMException('private URL or body','AbortError');});
  await assert.rejects(createWorkbenchSaveIO(env).names(),error=>error.name==='Error' && /列表检查被中断/.test(error.message) && !/private/.test(error.message));
  t.mock.method(globalThis,'fetch',async()=>({ok:false,status:503}));
  await assert.rejects(createWorkbenchSaveIO(env).write('/api/worldinfo/edit',{},'世界书写入'),/写入失败（HTTP 503）.*尚未确认/);
});
test('host TimeoutError is reported as timeout, while explicit AbortError remains cancelled',()=>{
  const log=createDiagnosticLog();
  log.begin('workbench-save-worldbook')('failed','TimeoutError');
  log.begin('ai-stitch-generate')('failed','AbortError');
  const report=formatDiagnosticReport({records:log.snapshot()});
  assert.match(report,/工作台保存世界书 \| 超时/);assert.match(report,/生成缝合方案 \| 已取消/);
});
