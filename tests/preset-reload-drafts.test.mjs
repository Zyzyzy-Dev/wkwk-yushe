// 宿主预设变化事件回归：后台读回、保存事件与未提交表单互不覆盖。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isPendingPromptDraft,buildPresetDraftSnapshot} from '../src/features/preset/entry-drafts.js';

const source=readFileSync(new URL('../src/ui/app.js',import.meta.url),'utf8');
const start=source.indexOf('function applyTavernPreset('),end=source.indexOf('/* 交互锁',start);
const watchStart=source.indexOf('function watchTavernPresetEvents('),watchEnd=source.indexOf('\n',watchStart);
const code=source.slice(start,end)+'\n'+source.slice(watchStart,watchEnd);
function harness(){
  const state={old:null,new:{prompts:[{identifier:'a',content:'original'}]},newName:'bound.json',tavernSource:{old:null,new:'bound'},dirty:{old:false,new:false},modified:{old:new Set(),new:new Set()},dragged:{old:new Set(),new:new Set()},mergeSave:true};
  const inlineDrafts=new WeakMap(),requests=[],handlers=new Map(),notices=[];
  const host={on:(type,fn)=>handlers.set(type,fn),request:(type,payload)=>new Promise((resolve,reject)=>requests.push({type,payload,resolve,reject}))};
  const deps={state,inlineDrafts,host,isPendingPromptDraft,buildPresetDraftSnapshot,clone:structuredClone,validate:p=>p,rebuildCache(){},renderAll(){},pcmToast:(...args)=>notices.push(args),console:{error(){},warn(){}}};
  const api=new Function(...Object.keys(deps),code+'\nfunction requestSideReload(side,name){void reloadSideFromTavern(side,name);}watchTavernPresetEvents();return {save:saveSideToTavern,reload:reloadSideFromTavern};')(...Object.values(deps));
  return {state,inlineDrafts,requests,notices,...api,changed:()=>handlers.get('preset-changed')({apiId:'openai',name:'bound'})};
}
test('native change event cannot reload an unsubmitted form whose dirty flag is false',()=>{
  const e=harness(),prompt=e.state.new.prompts[0];e.inlineDrafts.set(prompt,{content:'pending'});
  e.changed();assert.equal(e.requests.length,0);assert.equal(e.inlineDrafts.get(prompt).content,'pending');
});
test('save-triggered native change event cannot reload before merged save response',async()=>{
  const e=harness(),original=e.state.new;e.inlineDrafts.set(original.prompts[0],{content:'pending'});
  const saving=e.save('new');assert.equal(e.requests.length,1);e.changed();assert.equal(e.requests.length,1);
  e.requests[0].resolve(e.requests[0].payload.preset);await saving;
  assert.equal(e.state.new.prompts[0].content,'pending');assert.equal(e.state.dirty.new,false);
});
test('a new draft created while native read is pending survives the stale readback',async()=>{
  const e=harness(),original=e.state.new,prompt=original.prompts[0],reading=e.reload('new','bound');
  assert.equal(e.requests.length,1);e.inlineDrafts.set(prompt,{content:'new pending'});
  e.requests[0].resolve({prompts:[{identifier:'a',content:'stale host'}]});await reading;
  assert.equal(e.state.new,original);assert.equal(e.inlineDrafts.get(prompt).content,'new pending');
});
test('native read started before save cannot replace the model during that save',async()=>{
  const e=harness(),original=e.state.new,reading=e.reload('new','bound'),saving=e.save('new');
  assert.equal(e.requests.length,2);
  e.requests[0].resolve({prompts:[{identifier:'a',content:'stale read'}]});await reading;assert.equal(e.state.new,original);
  e.requests[1].resolve({...e.requests[1].payload.preset,canonical:true});await saving;assert.equal(e.state.new.canonical,true);
});
test('native read cannot apply after the user switches the source binding',async()=>{
  const e=harness(),original=e.state.new,reading=e.reload('new','bound');e.state.tavernSource.new='other';
  e.requests[0].resolve({prompts:[{identifier:'a',content:'wrong source'}]});await reading;assert.equal(e.state.new,original);
});
test('an unchanged form permits normal native reload',async()=>{
  const e=harness();e.inlineDrafts.set(e.state.new.prompts[0],{content:'original',name:'',role:'system',trigger:'',injection_position:'0'});
  const reading=e.reload('new','bound');assert.equal(e.requests.length,1);
  e.requests[0].resolve({prompts:[{identifier:'a',content:'fresh'}]});await reading;assert.equal(e.state.new.prompts[0].content,'fresh');
});
