// API 目录宿主测试：不使用网络、密钥或真实酒馆设置，核对写入边界、失败和并发更新。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as folders from '../src/shared/library-folders.js';
import {API_STORE_KEY} from '../src/features/api/api-manager.js';
import {API_BINDINGS_KEY} from '../src/features/api/api-bindings.js';
const src=readFileSync(new URL('../src/host/host.js',import.meta.url),'utf8');
const handler=src.slice(src.indexOf('async function handleApiManagerRequest('),src.indexOf('function workbenchWorldName('))
  .replace(/const \[openai, script, extensions, secrets\] = await Promise\.all\(\[[\s\S]*?\]\);/,'const {openai,script,extensions,secrets}=fixture;');
function setup({reject=false,staleDisk=false}={}){
  const profile={id:'a',name:'已有连接',secretId:'vault-ref',connection:{custom_url:'https://example.invalid'}};
  const settings={[API_STORE_KEY]:{version:1,profiles:[profile],other:17},[API_BINDINGS_KEY]:[{apiId:'a',snapshotId:'s'}]};
  const fixture={openai:{oai_settings:{}},extensions:{extension_settings:settings},script:{saveSettings:async()=>{if(reject)throw Error('reject');},saveSettingsDebounced(){}},secrets:{}};
  const deps={fixture,...folders,API_STORE_KEY,API_BINDINGS_KEY,readSnapshotPersistence:async()=>({settings:{extension_settings:staleDisk?{}:settings}}),fetch:()=>{throw Error('unexpected API or vault access');}};
  const api=new Function(...Object.keys(deps),handler+';return handleApiManagerRequest;')(...Object.values(deps));
  return {api,settings,profile};
}
const draft=[{id:'g',name:'专用',items:['a']}];
test('API 分组只写入目录；旧窗口不能覆盖，删除方案会清理其归属',async()=>{
  const {api,settings,profile}=setup(),bindings=settings[API_BINDINGS_KEY];
  assert.equal((await api('api-manager-folders',{expected:[],folders:draft})).verified,true);
  assert.equal(settings[API_STORE_KEY].profiles[0],profile);assert.equal(settings[API_BINDINGS_KEY],bindings);
  await assert.rejects(api('api-manager-folders',{expected:[],folders:[]}),/其他操作/);
  await api('api-manager-delete',{id:'a'});assert.deepEqual(settings[API_STORE_KEY],{version:1,other:17,profiles:[],folders:[{id:'g',name:'专用',items:[]}]});
});
test('API 原生拒绝写入时回滚；已接受但未核验时保留结果并如实标明',async()=>{
  const failed=setup({reject:true}),prior=failed.settings[API_STORE_KEY];
  await assert.rejects(failed.api('api-manager-folders',{expected:[],folders:draft}),/reject/);assert.equal(failed.settings[API_STORE_KEY],prior);
  const pending=setup({staleDisk:true}),r=await pending.api('api-manager-folders',{expected:[],folders:draft});
  assert.equal(r.verified,false);assert.deepEqual(pending.settings[API_STORE_KEY].folders,draft);
});
test('解除 API 分组保留方案、密钥引用和绑定，整组删除只清理该组方案及其绑定',async()=>{
  for(const deleteItems of [false,true]){
    const {api,settings,profile}=setup();settings[API_STORE_KEY].folders=structuredClone(draft);
    const other={id:'b',name:'其他'};settings[API_STORE_KEY].profiles.push(other);settings[API_BINDINGS_KEY].push({apiId:'b',snapshotId:'other'});
    const result=await api('api-manager-folder-delete',{id:'g',expected:draft,deleteItems,expectedItems:[structuredClone(profile)]});
    assert.equal(result.verified,true);assert.deepEqual(result.removedIds,deleteItems?['a']:[]);
    assert.deepEqual(settings[API_STORE_KEY].folders,[]);assert.deepEqual(settings[API_STORE_KEY].profiles,deleteItems?[other]:[profile,other]);
    assert.deepEqual(settings[API_BINDINGS_KEY],deleteItems?[{apiId:'b',snapshotId:'other'}]:[{apiId:'a',snapshotId:'s'},{apiId:'b',snapshotId:'other'}]);
  }
});
test('整组删除拒绝过期确认或缺少明确选择，失败时目录、成员和绑定一起恢复',async()=>{
  const h=setup({reject:true});h.settings[API_STORE_KEY].folders=structuredClone(draft);
  const original=h.settings[API_STORE_KEY],links=h.settings[API_BINDINGS_KEY];
  const payload={id:'g',expected:draft,deleteItems:true,expectedItems:[structuredClone(h.profile)]};
  await assert.rejects(h.api('api-manager-folder-delete',{...payload,deleteItems:undefined}),/请选择/);
  await assert.rejects(h.api('api-manager-folder-delete',{...payload,expectedItems:[{...h.profile,name:'stale'}]}),/方案已变化/);
  await assert.rejects(h.api('api-manager-folder-delete',{...payload,expected:[]}),/其他操作/);
  await assert.rejects(h.api('api-manager-folder-delete',payload),/reject/);
  assert.equal(h.settings[API_STORE_KEY],original);assert.equal(h.settings[API_BINDINGS_KEY],links);
  assert.deepEqual(original.folders,draft);assert.equal(original.profiles[0],h.profile);
});
