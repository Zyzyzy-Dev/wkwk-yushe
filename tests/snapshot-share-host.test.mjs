// 在模拟酒馆上经过面板实际 RPC 分派、快照队列与保存核验，检查导入隔离和应用前复核。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as codec from '../src/features/snapshot/snapshot-share.js';
import * as checks from '../src/host/snapshot-share-checks.js';
import * as presetReferences from '../src/host/snapshot-preset-rename.js';
import * as snapshots from '../src/features/snapshot/snapshot.js';
import * as resources from '../src/features/snapshot/snapshot-resources.js';

const source=readFileSync(new URL('../src/host/host.js',import.meta.url),'utf8');
function range(start,end) {
  const a=source.indexOf(start), b=source.indexOf(end,a+start.length);
  assert.ok(a>=0 && b>a);
  return source.slice(a,b);
}
const runtime=[
  range('function readPresetByName','function readPresetWithLiveHelper'),
  range('async function handleRequest','async function handleApiManagerRequest'),
  range('const SNAPSHOT_KEY','async function snapshotEnvironment'),
  range('function snapshotStore','async function snapshotReadBooks'),
  range('function assertSnapshotContext','async function readSnapshotPersistence'),
  range('async function saveSnapshotSettings','async function saveSnapshotMetadata'),
  range('async function prepareSnapshotResources','function snapshotSerial'),
  range('function snapshotSerial','async function withSnapshotTimeout'),
  range('function patchSnapshotSwitches','async function installSnapshotBindings'),
].join('\n');
const key='preset_compare_snapshots', links='preset_compare_api_snapshot_links';
const globalScript={id:'global',scriptName:'全局',findRegex:'x'};
const presetScript={id:'preset',scriptName:'预设规则',findRegex:'y'};
const groups={groups:[{id:'g',name:'第一组'}]};
function preset(name) {
  return {preset_settings_openai:name,prompts:[{identifier:'p',name:'开场'}],prompt_order:[{character_id:42,order:[{identifier:'p',enabled:false}]}],
    extensions:{baibaiToolkit:{presetPromptGroups:structuredClone(groups)},regex_scripts:[structuredClone(presetScript)]}};
}
function shared(name='故事') {
  return {id:'source',name,presetName:'另一份',orderCharacterId:771,entries:[{identifier:'p',name:'开场',enabled:true}],groups:[{id:'g',name:'第一组',enabled:true}],
    scope:{preset:true,worlds:true,regex:true,presetRegex:true,reasoning:false},worldNames:['书'],
    presetRegex:resources.capturePresetRegex([presetScript],{apiId:'openai',presetName:'另一份'}),
    resources:{version:2,worlds:{global:['书']},worldEntries:[{name:'书',entries:[{uid:'1',name:'森林',settings:{disable:true}}]}],regex:{global:resources.captureRegexSwitches([globalScript]),preset:[],character:[]}}};
}
function fixture() {
  const state={writes:0,reads:0,bookReads:0,mode:'ok',chat:'当前会话',selected:'当前',selections:0,time:0};
  const store={version:1,snapshots:[shared()],characterBindings:{'local.png':'source'},folders:[{id:'folder',name:'收藏'}]};
  const active=preset('当前'), target=preset('另一份');
  const catalog={preset_names:['当前','另一份'],presets:[active,target]};
  const book={entries:{1:{uid:1,comment:'森林',content:'本地正文',disable:false}}};
  const env={
    script:{main_api:'openai',this_chid:0,characters:[{avatar:'local.png'}],getCurrentChatId:()=>state.chat,chat_metadata:{[key]:{snapshotId:'source'}},
      saveSettings:async()=>{state.writes++;if(state.mode==='fail')throw Error('写入失败');await state.onSave?.();}},
    openai:{oai_settings:active,promptManager:{activeCharacter:{id:42}}},
    extensions:{extension_settings:{[key]:store,[links]:[{apiId:'local-api',snapshotId:'source'}],regex:[structuredClone(globalScript)]}},
    manager:{getPresetList:()=>catalog,getSelectedPresetName:()=>state.selected},
    world:{world_names:['书'],selected_world_info:[],world_info:{},worldInfoCache:new Map(),loadWorldInfo:async()=>{state.bookReads++;await state.onBook?.();return book;}},
  };
  const deps={...codec,...checks,...snapshots,...resources,...presetReferences,API_BINDINGS_KEY:links,clone:structuredClone,nativeGroupController:null,
    snapshotEnvironment:()=>env,readSnapshotReasoning:async()=>({current:{}}),waitSnapshotPreset:async()=>{},settleBaiBai:async()=>{},
    snapshotWorldSelection:()=>{},selectSnapshotPreset:(_env,name)=>{
      if (name!==state.selected) {state.selections++;state.selected=name;env.openai.oai_settings=catalog.presets[catalog.preset_names.indexOf(name)];}
    },
    withSnapshotTimeout:value=>value,syncSnapshotOriginalBook:()=>{},
    readSnapshotPersistence:async(_env,path)=>{
      if(path==='/api/worldinfo/get')return structuredClone(book);
      assert.equal(path,'/api/settings/get');state.reads++;
      if(state.mode==='unverified')throw Error('读取失败');
      return {settings:structuredClone({extension_settings:env.extensions.extension_settings,oai_settings:env.openai.oai_settings,world_info_settings:{world_info:env.world.world_info}})};
    },
    setTimeout:(fn,ms)=>{state.time+=ms;queueMicrotask(fn);return 0;},Date:{now:()=>state.time},
  };
  const call=new Function(...Object.keys(deps),runtime+'\nreturn handleRequest;')(...Object.values(deps));
  return {call,state,env,store,book,target,catalog};
}
const bundle=(...items)=>codec.buildSnapshotShare(items);

test('列表一次读取所有本机预设名，目录未就绪时仍可列出快照',async()=>{
  const f=fixture();
  let reads=0;
  f.env.manager.getPresetList=()=>{reads++;return f.catalog;};
  for (const [catalog,expected] of [
    [['当前','另一份'],['当前','另一份']], [{'当前':0,'另一份':1},['当前','另一份']],
    [['当前','旧版'],['当前','旧版']], [undefined,null], [[],null], [['当前',null],null],
  ]) {
    f.catalog.preset_names=catalog;
    const before=reads;
    const result=await f.call('snapshot-list',{});
    assert.deepEqual(result.context.presetNames,expected);
    assert.equal(result.snapshots[0].presetName,'另一份');
    assert.equal(reads-before,1);
  }
  assert.equal(f.state.reads,0);assert.equal(f.state.writes,0);
});

test('选择新预设期间旧名重新出现，保留原引用和设置',async()=>{
  const f=fixture(), original=structuredClone(f.store);
  f.catalog.preset_names[1]='新版';
  const contextKey=(await f.call('snapshot-list',{})).context.key;
  assert.ok(!(await f.call('snapshot-preset-options',{})).includes('另一份'));
  f.catalog.preset_names.push('另一份');f.catalog.presets.push(preset('另一份'));
  await assert.rejects(f.call('snapshot-retarget-preset',{id:'source',oldName:'另一份',newName:'新版',contextKey}),/原预设.*已可用/);
  assert.deepEqual(f.store,original);assert.equal(f.state.writes,0);assert.equal(f.state.selections,0);
});

test('手动重新指定可修复缺失预设，保留旧开关、正则指纹、身份和绑定',async()=>{
  const f=fixture(), original=f.store.snapshots[0];
  original.favorite=true;
  original.orderCharacterId=42;
  f.catalog.preset_names[1]='改名后';
  const ctx=(await f.call('snapshot-list',{})).context.key;
  assert.deepEqual(await f.call('snapshot-preset-options',{}),['当前','改名后']);
  const args={id:original.id,oldName:'另一份',newName:'改名后',contextKey:ctx};
  await assert.rejects(f.call('snapshot-retarget-preset',{...args,newName:'缺失'}),/目标预设/);
  await assert.rejects(f.call('snapshot-retarget-preset',{...args,oldName:'已过期'}),/刷新/);
  f.target.prompts[0].name='另一条';
  await assert.rejects(f.call('snapshot-retarget-preset',args),/冲突/);
  f.target.prompts[0].name='开场';
  f.state.mode='fail';
  await assert.rejects(f.call('snapshot-retarget-preset',args),/写入失败/);
  assert.equal(f.store.snapshots[0],original);
  f.state.mode='ok';
  await f.call('snapshot-retarget-preset',args);
  const next=f.store.snapshots[0];
  assert.deepEqual(next,{...original,updatedAt:next.updatedAt,presetName:'改名后',
    presetRegex:{...original.presetRegex,owner:{apiId:'openai',presetName:'改名后'}}});
  assert.equal(f.state.selections,0);assert.deepEqual(f.store.characterBindings,{'local.png':'source'});
  assert.equal(f.target.prompt_order[0].order[0].enabled,false);
  await assert.rejects(f.call('snapshot-save-draft',{id:next.id,originalPresetName:'另一份',contextKey:ctx}),/重新打开详情/);
});

test('接收方可以核对每一个缺少的条目，包括第四项以后的名称', async () => {
  const f=fixture(), data=shared();
  data.entries=Array.from({length:7},(_,i)=>({identifier:'missing-'+i,name:'外来条目'+i,enabled:true}));
  const preview=await f.call('snapshot-share-preview',{bundle:bundle(data)});
  const missing=preview.items[0].checks.filter(row=>row.status==='missing').map(row=>row.detail).join(' ');
  for(const entry of data.entries) assert.ok(missing.includes(entry.name),entry.name);
});

test('RPC 导出所选记录并预检非活动预设，批量共读世界书且不修改本地设置',async()=>{
  const f=fixture(), original=structuredClone(f.env.extensions.extension_settings);
  const data=await f.call('snapshot-share-export',{ids:['source']});
  assert.deepEqual(data,bundle(shared()));
  for (const ids of [[],['source','source'],['unknown']]) await assert.rejects(f.call('snapshot-share-export',{ids}));
  const preview=await f.call('snapshot-share-preview',{bundle:bundle(shared(),shared('夜晚'))});
  assert.deepEqual(preview.items.map(item=>item.name),['故事','夜晚']);
  const rows=preview.items[0].checks;
  for (const label of ['预设「另一份」','预设条目','预设分组','预设正则','世界书「书」','世界书「书」条目']) {
    assert.ok(rows.some(item=>item.label===label&&item.status==='matched'),label);
  }
  assert.ok(rows.some(item=>item.label==='全局正则'&&item.status==='unknown'&&/指纹/.test(item.detail)));
  assert.equal(f.state.writes,0);assert.equal(f.state.bookReads,1);assert.equal(f.state.selections,0);
  assert.deepEqual(f.env.extensions.extension_settings,original);
});

test('同 ID 异名、同名异 ID、世界书 UID 冲突及预设正则定义改变分项提示',async()=>{
  const f=fixture();
  f.target.prompts[0].name='别的开场';
  f.target.extensions.baibaiToolkit.presetPromptGroups.groups[0].id='another';
  f.target.extensions.regex_scripts[0].findRegex='changed';
  f.book.entries[1].comment='沙漠';
  f.env.extensions.extension_settings.regex[0].scriptName='另一个';
  const {items}=await f.call('snapshot-share-preview',{bundle:bundle(shared())});
  for (const label of ['预设条目','预设分组','预设正则','世界书「书」条目','全局正则']) {
    assert.ok(items[0].checks.some(row=>row.label===label&&row.status==='conflict'),label);
  }
});

test('缺少本地依赖仍可整批存为副本，生成本地节点和独立身份，绑定/当前设置保留',async()=>{
  const f=fixture(), data=bundle(shared(),shared());
  f.catalog.preset_names.pop();f.env.world.world_names=[];
  const preview=await f.call('snapshot-share-preview',{bundle:data});
  assert.equal(preview.items[0].checks.filter(item=>item.status==='missing').length,2);
  const result=await f.call('snapshot-share-import',{bundle:data,contextKey:preview.contextKey});
  assert.equal(result.busy,false);assert.equal(result.persistence,null);
  assert.equal(f.state.writes,1);assert.equal(f.state.selections,0);
  assert.deepEqual(f.store.snapshots.map(s=>s.name),['故事','故事（副本）','故事（副本 2）']);
  assert.equal(new Set(f.store.snapshots.map(s=>s.id)).size,3);
  for (const s of f.store.snapshots.slice(1)){assert.equal(s.orderCharacterId,42);assert.equal(s.importedShare,true);}
  assert.deepEqual(f.store.characterBindings,{'local.png':'source'});assert.deepEqual(f.env.script.chat_metadata,{[key]:{snapshotId:'source'}});
  assert.deepEqual(f.env.extensions.extension_settings[links],[{apiId:'local-api',snapshotId:'source'}]);
  assert.deepEqual(f.env.world.selected_world_info,[]);assert.equal(f.env.openai.oai_settings.prompt_order[0].order[0].enabled,false);
  assert.deepEqual(codec.buildSnapshotShare([f.store.snapshots[1]]).snapshots[0],{...data.snapshots[0],name:'故事（副本）'});
});

test('后项非法整批不写；宿主明确失败恢复原数组；回读中断保留待核验且只写一次',async()=>{
  const f=fixture(), data=bundle(shared(),shared()), previous=f.store.snapshots, invalid=structuredClone(data);
  invalid.snapshots[1].entries[0].enabled='yes';
  await assert.rejects(f.call('snapshot-share-import',{bundle:invalid}),/第 2 份/);
  assert.equal(f.store.snapshots,previous);assert.equal(f.state.writes,0);
  f.state.mode='fail';
  await assert.rejects(f.call('snapshot-share-import',{bundle:data}),/写入失败/);assert.equal(f.store.snapshots,previous);
  f.state.mode='unverified';
  const result=await f.call('snapshot-share-import',{bundle:data});
  assert.equal(f.state.writes,2);assert.equal(result.persistence.verified,false);assert.equal(result.snapshots.length,3);
  f.state.mode='ok';
  assert.equal((await f.call('snapshot-verify',{})).persistence,null);assert.equal(f.state.writes,2);
});

test('上下文变化使预检失效，确认前切换条目节点也须重读；无节点明确标记并回退公共节点',async()=>{
  const f=fixture(),data=bundle(shared());
  f.state.onBook=()=>{f.state.chat='另一个会话';};
  await assert.rejects(f.call('snapshot-share-preview',{bundle:data}),/重新预检/);
  f.state.onBook=null;
  const previous=await f.call('snapshot-share-preview',{bundle:data});
  delete f.env.openai.promptManager.activeCharacter;
  await assert.rejects(f.call('snapshot-share-import',{bundle:data,contextKey:previous.contextKey}),/重新预检/);
  assert.equal(f.state.writes,0);
  const latest=await f.call('snapshot-share-preview',{bundle:data});
  assert.ok(latest.items[0].checks.some(row=>row.status==='unknown'&&/公共节点/.test(row.detail)));
  await f.call('snapshot-share-import',{bundle:data,contextKey:latest.contextKey});
  assert.equal(f.store.snapshots.at(-1).orderCharacterId,100001);
});

test('并发导入在同一队列生成新名称，各写一次',async()=>{
  const f=fixture(),data=bundle(shared());
  const inSave=Promise.withResolvers(),release=Promise.withResolvers();
  f.state.onSave=()=>{inSave.resolve();return release.promise;};
  const one=f.call('snapshot-share-import',{bundle:data});
  await inSave.promise;
  const two=f.call('snapshot-share-import',{bundle:data});
  await Promise.resolve();assert.equal(f.state.writes,1);release.resolve();
  await Promise.all([one,two]);
  assert.deepEqual(f.store.snapshots.map(s=>s.name),['故事','故事（副本）','故事（副本 2）']);assert.equal(f.state.writes,2);
});

test('导入后本地资源更换身份，实际应用在切换预设和写入前拒绝',async()=>{
  for (const change of [f=>{f.target.prompts[0].name='另一个条目';},f=>{f.book.entries[1].comment='沙漠';},f=>{f.env.extensions.extension_settings.regex[0].scriptName='重用标识';}]) {
    const f=fixture(),result=await f.call('snapshot-share-import',{bundle:bundle(shared())});
    change(f);
    await assert.rejects(f.call('snapshot-apply',{id:f.store.snapshots[1].id,contextKey:result.context.key}),/资源冲突/);
    assert.equal(f.state.selections,0);assert.equal(f.state.writes,1);
    assert.equal(f.book.entries[1].disable,false);assert.equal(f.env.openai.oai_settings.prompt_order[0].order[0].enabled,false);
  }
});

test('导入不切预设，应用时切到指定预设并保留自加条目及旧版预设的开关',async()=>{
  const f=fixture(), item=shared();
  item.scope={...item.scope,worlds:false,regex:false,presetRegex:false};
  const previousPreset=structuredClone(f.env.openai.oai_settings);
  const localEntries=[{identifier:'local-on',enabled:true},{identifier:'local-off',enabled:false}];
  f.target.prompts.push(...localEntries.map(({identifier})=>({identifier,name:identifier})));
  f.target.prompt_order[0].order.push(...structuredClone(localEntries));
  const result=await f.call('snapshot-share-import',{bundle:bundle(item)});
  assert.equal(f.state.selected,'当前');assert.equal(f.target.prompt_order[0].order[0].enabled,false);
  const applied=await f.call('snapshot-apply',{id:result.snapshots.at(-1).id,contextKey:result.context.key});
  assert.deepEqual(applied.warnings,[]);assert.equal(f.state.selected,'另一份');
  assert.deepEqual(f.target.prompt_order[0].order,[{identifier:'p',enabled:true},...localEntries]);
  assert.deepEqual(f.catalog.presets[0],previousPreset);
  assert.equal(f.target.extensions.baibaiToolkit.presetPromptGroups.groups[0].enabled,true);
  assert.equal(f.state.selections,1);assert.equal(f.state.writes,2);
});
