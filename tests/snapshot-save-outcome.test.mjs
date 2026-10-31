// 真实宿主快照增删改：保存与回读失败分开处理，保留未确认结果并提供只读复核。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as snapshots from '../src/features/snapshot/snapshot.js';
import * as resources from '../src/features/snapshot/snapshot-resources.js';
import * as reasoning from '../src/features/snapshot/snapshot-reasoning.js';
import {createIdentifier} from '../src/features/preset/core.js';

const source=fs.readFileSync(new URL('../src/host/host.js',import.meta.url),'utf8');
const block=source.slice(source.indexOf('const SNAPSHOT_KEY ='),source.indexOf('async function installSnapshotBindings('))
  .replace(/async function snapshotEnvironment\(\) \{[\s\S]*?\n\}/,'async function snapshotEnvironment(){return fixtureEnv;}');
const snapshotKey='preset_compare_snapshots',linksKey='bindings';
const scope={preset:true,worlds:false,regex:false,reasoning:false,presetRegex:false};
const reasoningConfig={version:1,auto_parse:false,name:'自定义',prefix:'<think>',suffix:'</think>',separator:'\r\n'};
const emptyResources={version:2,worlds:{global:[]},regex:{global:[],preset:[],character:[]},worldEntries:[]};
function fixture({readMode='match',writeMode='save'}={}){
  const preset={preset_settings_openai:'A',prompts:[{identifier:'p',name:'提示词',content:'不可改写的正文'}],prompt_order:[{character_id:1,order:[{identifier:'p',enabled:true}]}],extensions:{}};
  const saved=id=>({...snapshots.captureSnapshot({id,name:id,presetName:'A',settings:preset,orderCharacterId:1,groupState:null,worldNames:[],now:1}),scope:{...scope},resources:structuredClone(emptyResources)});
  const store={version:1,snapshots:[saved('a'),saved('b')],characterBindings:{'hero.png':'a'}};
  const extensions={extension_settings:{[snapshotKey]:store,[linksKey]:[{apiId:'api-a',snapshotId:'a'},{apiId:'api-b',snapshotId:'b'}],unrelated:{keep:1}}};
  let writes=0,reads=0;
  const env={extensions,openai:{oai_settings:preset,promptManager:{activeCharacter:{id:1},render:async()=>{}}},world:{world_names:[],selected_world_info:[],world_info:{charLore:[]}},script:{main_api:'openai',this_chid:0,characters:[{avatar:'hero.png',name:'角色',chat:'chat'}],getCurrentChatId:()=> 'chat',getRequestHeaders:()=>({}),isGenerating:()=>false,saveSettings:async()=>{
    writes++;if(writeMode==='throw')throw Error('native write rejected');
    if(writeMode!=='swallow')disk=structuredClone({extension_settings:extensions.extension_settings,oai_settings:preset,world_info_settings:{world_info:{globalSelect:[]}}});
  }}};
  env.manager={getPresetList:()=>({presets:[preset],preset_names:{A:0},settings:preset}),getSelectedPresetName:()=> 'A'};
  let disk=structuredClone({extension_settings:extensions.extension_settings,oai_settings:preset,world_info_settings:{world_info:{globalSelect:[]}}});
  const dependencies={...snapshots,...resources,...reasoning,createIdentifier,clone:structuredClone,fixtureEnv:env,nativeGroupController:null,globalThis:{},document:{querySelector:()=>null,getElementById:()=>null},API_BINDINGS_KEY:linksKey,
    readPresetByName:()=>preset,readSnapshotReasoning:async()=>{throw Error('fixture has no active reasoning')},
    setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,1)),clearTimeout,
    fetch:async(url,options)=>{assert.equal(url,'/api/settings/get');assert.equal(options.method,'POST');reads++;if(readMode==='unavailable')throw Error('回读网络中断');const value=structuredClone(disk);if(readMode==='links-mismatch')value.extension_settings[linksKey]=[{apiId:'stale',snapshotId:'a'}];return {ok:true,json:async()=>({settings:value})};}
  };
  const api=new Function(...Object.keys(dependencies),block+';return handleSnapshotRequest;')(...Object.values(dependencies));
  const key=async()=>(await api('snapshot-list',{})).context.key;
  return {api,key,env,store,get disk(){return disk},get writes(){return writes},get reads(){return reads},set readMode(v){readMode=v},set writeMode(v){writeMode=v}};
}
const operations=[
  {name:'新建',method:'snapshot-save',payload:()=>({name:'新建快照',scope}),check:r=>assert.equal(r.snapshots.filter(s=>s.name==='新建快照').length,1)},
  {name:'详情修改',method:'snapshot-save-draft',payload:h=>({id:'a',name:'详情修改',draft:{...structuredClone(h.store.snapshots[0]),entries:[{identifier:'p',name:'提示词',enabled:false}]}}),check:r=>{assert.equal(r.snapshots[0].name,'详情修改');assert.equal(r.snapshots[0].entries[0].enabled,false);}},
  {name:'改名',method:'snapshot-rename',payload:()=>({id:'a',name:'改名结果'}),check:r=>assert.equal(r.snapshots[0].name,'改名结果')},
  {name:'收藏',method:'snapshot-favorite',payload:()=>({id:'a',favorite:true}),check:r=>assert.equal(r.snapshots[0].favorite,true)},
  {name:'推理绑定修改',method:'snapshot-reasoning-save',payload:()=>({id:'a',config:reasoningConfig}),check:r=>assert.deepEqual(r.snapshots[0].reasoning,reasoningConfig)},
  {name:'删除与关联清理',method:'snapshot-delete',payload:()=>({id:'a'}),check:(r,h)=>{assert.deepEqual(r.snapshots.map(s=>s.id),['b']);assert.deepEqual(h.store.characterBindings,{});assert.deepEqual(h.env.extensions.extension_settings[linksKey],[{apiId:'api-b',snapshotId:'b'}]);}},
  {name:'角色绑定修改',method:'snapshot-bind',payload:()=>({id:'b',target:'character'}),check:(_r,h)=>assert.equal(h.store.characterBindings['hero.png'],'b')},
];
for(const operation of operations){
  test(`回读异常保留已写入的${operation.name}，列表刷新也显示待核对`,async()=>{
    const h=fixture({readMode:'unavailable'}),payload={...operation.payload(h),contextKey:await h.key()};
    const result=await h.api(operation.method,payload);operation.check(result,h);
    assert.equal(result.persistence?.verified,false);assert.ok(result.persistence.message);
    assert.equal(h.writes,1);assert.ok(h.reads>=1&&h.reads<=8);
    assert.deepEqual(h.env.extensions.extension_settings,h.disk.extension_settings);
    const listed=await h.api('snapshot-list',{});operation.check(listed,h);assert.equal(listed.persistence?.verified,false);assert.equal(h.writes,1);
  });
  test(`原生写入明确拒绝时回滚${operation.name}，不读取或伪报成功`,async()=>{
    const h=fixture({writeMode:'throw'}),before=structuredClone(h.env.extensions.extension_settings),payload={...operation.payload(h),contextKey:await h.key()};
    await assert.rejects(h.api(operation.method,payload),/native write rejected/);
    assert.equal(h.writes,1);assert.equal(h.reads,0);assert.deepEqual(h.env.extensions.extension_settings,before);
    assert.equal((await h.api('snapshot-list',{})).persistence??null,null);
  });
}
test('宿主吞掉写入失败但完整磁盘内容持续不匹配时拒绝并回滚',async()=>{
  const h=fixture({writeMode:'swallow'}),before=structuredClone(h.env.extensions.extension_settings);
  await assert.rejects(h.api('snapshot-rename',{id:'a',name:'不会落盘'}),/未确认|不一致/);
  assert.deepEqual(h.env.extensions.extension_settings,before);assert.equal(h.writes,1);assert.ok(h.reads>1&&h.reads<=8);
});
test('重新核对只读取，不重复写入；读取恢复一致后清除待核对状态',async()=>{
  const h=fixture({readMode:'unavailable'});await h.api('snapshot-rename',{id:'a',name:'已落盘'});
  const pending=await h.api('snapshot-verify',{});assert.equal(pending.persistence?.verified,false);assert.equal(h.writes,1);
  h.readMode='match';const verified=await h.api('snapshot-verify',{});assert.equal(verified.persistence??null,null);assert.equal(verified.snapshots[0].name,'已落盘');assert.equal(h.writes,1);
  assert.equal((await h.api('snapshot-list',{})).persistence??null,null);
  const reads=h.reads;await h.api('snapshot-verify',{});assert.equal(h.reads,reads);assert.equal(h.writes,1);
});
test('待核对删除必须同时确认 API 关联清理，快照库一致不能提前报完成',async()=>{
  const h=fixture({readMode:'unavailable'});await h.api('snapshot-delete',{id:'a'});
  h.readMode='links-mismatch';const pending=await h.api('snapshot-verify',{});assert.equal(pending.persistence?.verified,false);assert.deepEqual(pending.snapshots.map(s=>s.id),['b']);assert.equal(h.writes,1);
  h.readMode='match';const verified=await h.api('snapshot-verify',{});assert.equal(verified.persistence??null,null);assert.equal(h.writes,1);
});
test('后续写入被拒绝时保留前一次待核对结果与提示',async()=>{
  const h=fixture({readMode:'unavailable'});await h.api('snapshot-rename',{id:'a',name:'第一次已提交'});h.writeMode='throw';
  await assert.rejects(h.api('snapshot-rename',{id:'a',name:'第二次被拒绝'}),/native write rejected/);
  const result=await h.api('snapshot-list',{});assert.equal(result.snapshots[0].name,'第一次已提交');assert.equal(result.persistence?.verified,false);
});
