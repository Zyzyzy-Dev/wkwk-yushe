// 宿主真实快照闭包回归；只替换原生模块、DOM、网络和计时边界。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as snapshots from '../src/features/snapshot/snapshot.js';
import * as resources from '../src/features/snapshot/snapshot-resources.js';
import {createIdentifier} from '../src/features/preset/core.js';
const src=fs.readFileSync(new URL('../src/host/host.js',import.meta.url),'utf8');
const block=src.slice(src.indexOf("const SNAPSHOT_KEY ="),src.indexOf('async function installSnapshotBindings('))
 .replace(/async function snapshotEnvironment\(\) \{[\s\S]*?\n\}/,'async function snapshotEnvironment(){return fixtureEnv;}');
const preset=name=>({preset_settings_openai:name,prompts:[{identifier:'p',name:'提示词'}],prompt_order:[{character_id:1,order:[{identifier:'p',enabled:true}]}],extensions:{regex_scripts:[{id:'shared',scriptName:name,findRegex:name,replaceString:'',disabled:false,custom:{keep:1}}]}});
function fixture({failLoad=false,duringLoad,duringSave,allow=true}={}){
 const presets=[preset('A'),preset('B')],settings=structuredClone(presets[0]),listeners=new Map();let chat='chat',disk=null,saves=0,loads=0;
 const eventSource={on(n,f){listeners.set(n,[...(listeners.get(n)||[]),f]);},removeListener(n,f){listeners.set(n,(listeners.get(n)||[]).filter(x=>x!==f));},async emit(n){for(const f of [...listeners.get(n)||[]])await f();}};
 const env={openai:{oai_settings:settings,promptManager:{activeCharacter:{id:1},render:async()=>{}}},extensions:{extension_settings:{regex:[{id:'shared',disabled:false,findRegex:'global'}],preset_allowed_regex:{openai:allow?['A','B']:[]}}},world:{world_names:[],selected_world_info:[],world_info:{}},script:{main_api:'openai',getRequestHeaders:()=>({}),characters:[],getCurrentChatId:()=>chat,isGenerating:()=>false,eventSource,event_types:{OAI_PRESET_CHANGED_AFTER:'after',PRESET_CHANGED:'preset'},saveSettings:async()=>{saves++;if(duringSave)await duringSave(env,saves);disk=structuredClone({extension_settings:env.extensions.extension_settings,oai_settings:settings,world_info_settings:{world_info:{globalSelect:[]}}});}}};
 env.manager={getPresetList:()=>({presets,preset_names:{A:0,B:1},settings}),getSelectedPresetName:()=>settings.preset_settings_openai,readPresetExtensionField:({path})=>settings.extensions[path],selectPreset:i=>{loads++;if(failLoad)return;setTimeout(async()=>{Object.assign(settings,structuredClone(presets[i]));if(duringLoad)duringLoad(env);await eventSource.emit('after');await new Promise(r=>setTimeout(r,8));env.regexReady=true;await eventSource.emit('preset');},5);}};
 const globalObject={};
 const dependencies={...snapshots,...resources,createIdentifier,clone:structuredClone,fixtureEnv:env,nativeGroupController:null,globalThis:globalObject,document:{querySelector:()=>null,getElementById:()=>null},setTimeout:(f,ms)=>setTimeout(f,Math.min(ms,40)),clearTimeout,API_BINDINGS_KEY:'bindings',readSnapshotReasoning:async()=>{throw Error('fixture has no reasoning')},readPresetByName:(m,n)=>presets[m.getPresetList().preset_names[n]],fetch:async()=>({ok:true,json:async()=>({settings:disk})})};
 const api=new Function(...Object.keys(dependencies),block+';return handleSnapshotRequest;')(...Object.values(dependencies));
 const key=async()=>(await api('snapshot-list',{})).context.key;
 return {api,env,settings,presets,globalObject,key,get saves(){return saves},get loads(){return loads},get disk(){return disk},changeChat(){chat='other'}};
}
const scope={preset:true,presetRegex:true,worlds:false,regex:false,reasoning:false};
async function make(f,target='B'){
 const contextKey=await f.key(),model=await f.api('snapshot-editor',{contextKey}),p=await f.api('snapshot-draft-preset',{contextKey,presetName:target});
 Object.assign(model.draft,p,{scope:{...scope}});
 // Independent contract fixture also catches the host dropping the new RPC field.
 model.draft.presetRegex=resources.capturePresetRegex(f.presets[target==='A'?0:1].extensions.regex_scripts,{apiId:'openai',presetName:target});
 model.draft.presetRegex.switches[0].enabled=false;
 return {draft:model.draft,contextKey};
}
test('save_reload_apply_retains_preset_regex',async()=>{
 const f=fixture(),input=await make(f);const response=await f.api('snapshot-save-draft',{...input,name:'B 快照'}),saved=response.snapshots[0];
 assert.deepEqual(saved.presetRegex,input.draft.presetRegex);assert.deepEqual(f.disk.extension_settings.preset_compare_snapshots.snapshots[0].presetRegex,saved.presetRegex);
 assert.equal(f.settings.preset_settings_openai,'A');assert.equal(f.presets[1].extensions.regex_scripts[0].disabled,false);
 await f.api('snapshot-apply',{id:saved.id,contextKey:await f.key()});assert.equal(f.settings.preset_settings_openai,'B');assert.equal(f.env.regexReady,true);assert.equal(f.settings.extensions.regex_scripts[0].disabled,true);
 assert.equal(f.env.extensions.extension_settings.regex[0].disabled,false);
});
test('apply_a_b_a_uses_target_rules and R off loads native target rules',async()=>{
 const f=fixture();for(const name of ['A','B']){const input=await make(f,name);await f.api('snapshot-save-draft',{...input,name});}
 const store=f.env.extensions.extension_settings.preset_compare_snapshots;
 for(const name of ['A','B','A']){await f.api('snapshot-apply',{id:store.snapshots.find(s=>s.name===name).id,contextKey:await f.key()});assert.equal(f.settings.extensions.regex_scripts[0].findRegex,name);assert.equal(f.settings.extensions.regex_scripts[0].disabled,true);}
 store.snapshots[1].scope.presetRegex=false;
 await f.api('snapshot-apply',{id:store.snapshots[1].id,contextKey:await f.key()});assert.equal(f.settings.extensions.regex_scripts[0].findRegex,'B');assert.equal(f.settings.extensions.regex_scripts[0].disabled,false);
});
test('draft current and selected sources are distinct, including valid empty rules',async()=>{
 const f=fixture();f.presets[1].extensions.regex_scripts=[];
 const draft=await f.api('snapshot-draft-preset',{presetName:'B',contextKey:await f.key()});assert.deepEqual(draft.presetRegex,{version:1,owner:{apiId:'openai',presetName:'B'},switches:[]});
 const saved=await f.api('snapshot-save',{name:'当前',scope,contextKey:await f.key()});assert.equal(saved.snapshots[0].presetRegex.owner.presetName,'A');
});
test('legacy overwrite does not expand scope or resurrect old arrays',async()=>{
 const f=fixture();await f.api('snapshot-save',{name:'旧',scope:{...scope,presetRegex:false},contextKey:await f.key()});
 const saved=f.env.extensions.extension_settings.preset_compare_snapshots.snapshots[0];delete saved.scope.presetRegex;saved.resources.regex.preset=[{id:'shared',enabled:false}];
 await f.api('snapshot-save',{id:saved.id,name:'旧',scope,contextKey:await f.key()});const updated=f.env.extensions.extension_settings.preset_compare_snapshots.snapshots[0];assert.equal(updated.scope.presetRegex,false);assert.equal(updated.presetRegex,undefined);
});
test('changed definitions preflight blocks switching and after-load revalidation blocks patching',async()=>{
 for(const timing of ['before','after']){
  const f=fixture({duringLoad:timing==='after'?e=>{e.openai.oai_settings.extensions.regex_scripts[0].findRegex='changed'}:undefined});
  const result=await f.api('snapshot-save-draft',{...await make(f),name:'B'});if(timing==='before')f.presets[1].extensions.regex_scripts[0].findRegex='changed';
  await assert.rejects(f.api('snapshot-apply',{id:result.snapshots[0].id,contextKey:await f.key()}),/定义.*变化/);
  assert.equal(f.loads,timing==='before'?0:1);assert.equal(f.settings.extensions.regex_scripts[0].disabled,false);
 }
});
test('native load timeout never applies old source or spoofs completion',async()=>{
 const f=fixture({failLoad:true}),saved=await f.api('snapshot-save-draft',{...await make(f),name:'B'});
 await assert.rejects(f.api('snapshot-apply',{id:saved.snapshots[0].id,contextKey:await f.key()}),/加载超时/);assert.equal(f.settings.preset_settings_openai,'A');assert.equal(f.settings.extensions.regex_scripts[0].disabled,false);
});
test('save failure rollback preserves concurrent rule replacement and unrelated fields',async()=>{
 let applying=false;
 const f=fixture({duringSave:(env)=>{if(applying){applying=false;const s=env.openai.oai_settings.extensions.regex_scripts[0];s.findRegex='external';s.custom.keep=99;throw Error('write failed');}}});
 const saved=await f.api('snapshot-save-draft',{...await make(f),name:'B'});applying=true;
 await assert.rejects(f.api('snapshot-apply',{id:saved.snapshots[0].id,contextKey:await f.key()}),/write failed/);
 assert.equal(f.settings.extensions.regex_scripts[0].disabled,true);assert.equal(f.settings.extensions.regex_scripts[0].findRegex,'external');assert.equal(f.settings.extensions.regex_scripts[0].custom.keep,99);
});
test('unapproved rules report inactive execution without granting permission',async()=>{
 const f=fixture({allow:false}),saved=await f.api('snapshot-save-draft',{...await make(f),name:'B'});
 const result=await f.api('snapshot-apply',{id:saved.snapshots[0].id,contextKey:await f.key()});assert.match(result.warnings.join(' '),/授权/);assert.deepEqual(f.env.extensions.extension_settings.preset_allowed_regex.openai,[]);
});
test('changing chat during native selection blocks all snapshot changes',async()=>{
 let f;f=fixture({duringLoad:()=>f.changeChat()});const saved=await f.api('snapshot-save-draft',{...await make(f),name:'B'});
 await assert.rejects(f.api('snapshot-apply',{id:saved.snapshots[0].id,contextKey:await f.key()}),/聊天或预设已切换/);assert.equal(f.settings.extensions.regex_scripts[0].disabled,false);
});
test('failed save rolls back owned switches but preserves unrelated concurrent fields',async()=>{
 let applying=false;const f=fixture({duringSave:env=>{if(applying){applying=false;env.openai.oai_settings.temperature=0.9;throw Error('write failed');}}});
 const saved=await f.api('snapshot-save-draft',{...await make(f),name:'B'});applying=true;
 await assert.rejects(f.api('snapshot-apply',{id:saved.snapshots[0].id,contextKey:await f.key()}),/当前预设为「B」/);assert.equal(f.settings.extensions.regex_scripts[0].disabled,false);assert.equal(f.settings.temperature,0.9);
});
test('BaiBai copies receive only switch changes, stale definitions are not overwritten',async()=>{
 for(const stale of [false,true]){
  let copy;const f=fixture({duringLoad:env=>{copy=structuredClone(env.openai.oai_settings.extensions.regex_scripts[0]);if(stale)copy.findRegex='external';}});
  const saved=await f.api('snapshot-save-draft',{...await make(f),name:'B'});
  const runtime={pendingRegexScriptSaves:new Map(),vueManager:{state:{lists:{preset:{get groups(){return [{scripts:copy?[copy]:[]}]}}}}}};
  f.globalObject.__baiBaiToolkitExtensionInstalled={regexQuickOperationOptimization:runtime};
  const apply=f.api('snapshot-apply',{id:saved.snapshots[0].id,contextKey:await f.key()});
  if(stale){await assert.rejects(apply,/定义.*变化/);assert.equal(copy.findRegex,'external');assert.equal(copy.disabled,false);assert.equal(f.settings.extensions.regex_scripts[0].disabled,false);}
  else{await apply;assert.equal(copy.disabled,true);assert.equal(copy.findRegex,'B');assert.deepEqual(copy.custom,{keep:1});}
 }
});
test('current capture waits for full native application even when selection name already changed',async()=>{
 const f=fixture();let settled=false;
 f.env.openai.getPresetApplicationPromise=()=>new Promise(resolve=>setTimeout(()=>{settled=true;f.settings.extensions.regex_scripts[0].disabled=true;resolve();},6));
 const saved=await f.api('snapshot-save',{name:'完整加载',scope,contextKey:await f.key()});assert.equal(settled,true);assert.equal(saved.snapshots[0].presetRegex.switches[0].enabled,false);
});
