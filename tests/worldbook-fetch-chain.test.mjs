// 验证宿主写入追踪兼容转发包装，并拒绝绕过、异常及检查期间替换。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../src/host/host.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function installWorkbenchWorldWriteGuard('),source.indexOf('\nasync function awaitWorkbenchWorldWrites('));
function fixture(){
  const calls=[];const native=function(...args){calls.push({receiver:this,args});return Promise.resolve(new Response('{}'));};
  const host={fetch:native};
  const state=new Function('globalThis','location','withSnapshotTimeout',code+';return installWorkbenchWorldWriteGuard();')(host,{href:'https://example.test/',origin:'https://example.test'},p=>p);
  return {host,state,calls,native};
}
test('async forwarding wrappers retain tracking without sending probe to server',async()=>{
  const {host,state,calls}=fixture();const previous=host.fetch;
  host.fetch=async function(...args){return await previous.apply(this,args)};
  await state.verify();assert.equal(calls.length,0);
  await host.fetch('/api/worldinfo/edit',{method:'POST',body:'{}'});
  assert.equal(state.version,1);assert.equal(calls.length,1);assert.equal(calls[0].receiver,host);
  await Promise.all([...state.pending]);assert.equal(state.uncertain,false);
});
test('bypassing the guard remains blocked',async()=>{
  const {host,state,native}=fixture();host.fetch=native;await assert.rejects(state.verify(),/追踪链发生变化/);
});
test('replacement during probe cannot be accepted',async()=>{
  const {host,state,native}=fixture();const previous=host.fetch;
  host.fetch=async(...args)=>{const result=await previous(...args);host.fetch=native;return result};
  await assert.rejects(state.verify(),/追踪链发生变化/);
});
test('forwarding a failed tracked write keeps uncertain state',async()=>{
  const host={fetch:()=>Promise.reject(Error('network'))};
  const state=new Function('globalThis','location','withSnapshotTimeout',code+';return installWorkbenchWorldWriteGuard();')(host,{href:'https://example.test/',origin:'https://example.test'},p=>p);
  const previous=host.fetch;host.fetch=(...args)=>previous(...args);await state.verify();
  await assert.rejects(host.fetch('/api/worldinfo/edit'),/network/);await Promise.all([...state.pending]);assert.equal(state.uncertain,true);
});
