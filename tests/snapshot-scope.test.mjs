// 快照范围回归：未选数据不持久化、不参与恢复，兼容旧范围并拒绝空范围。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as snapshots from '../src/snapshot.js';
const base = () => ({id:'s',name:'部分设置',presetName:'已删除预设',orderCharacterId:1,entries:[{identifier:'a',enabled:true}],groups:[{id:'g',enabled:true}],worldNames:['书'],resources:{version:2,worlds:{global:['书']},worldEntries:[{name:'书',entries:[]}],regex:{global:[{id:'r',enabled:true}],preset:[],character:[]}}});
test('saving selected scopes strips excluded data without mutating the editor draft',()=>{
 const draft=base();draft.scope={preset:true,worlds:true,regex:false};const before=JSON.stringify(draft);
 const saved=snapshots.selectSnapshotScope(draft);
 assert.deepEqual(saved.resources.regex,{global:[],preset:[],character:[]});assert.equal(saved.entries.length,1);assert.deepEqual(saved.worldNames,['书']);assert.equal(JSON.stringify(draft),before);
});
test('world-only restore ignores unavailable preset nodes and excluded stale records',()=>{
 const draft=base();draft.scope={preset:false,worlds:true,regex:false};
 const plan=snapshots.planSnapshotRestore(draft,{settings:null,orderCharacterId:null,groupState:null,worldNames:['书']});
 assert.deepEqual(plan,{entries:[],groups:[],worldNames:['书'],missingEntries:[],missingGroups:[],missingWorldNames:[]});
});
test('excluded worlds are not mistaken for an explicit empty mount list',()=>{
 const draft=base();draft.scope={preset:false,worlds:false,regex:true};
 const saved=snapshots.selectSnapshotScope(draft);assert.deepEqual(saved.worldNames,[]);assert.deepEqual(saved.resources.worldEntries,[]);assert.deepEqual(saved.entries,[]);
 const plan=snapshots.planSnapshotRestore(saved,{worldNames:[]});assert.deepEqual(plan.missingWorldNames,[]);assert.equal(snapshots.snapshotScope(saved).worlds,false);
});
test('legacy scope defaults keep pre-resource regex excluded and resource snapshots complete',()=>{
 const saved=base();assert.deepEqual(snapshots.snapshotScope(saved),{preset:true,worlds:true,regex:true});
 delete saved.resources;assert.deepEqual(snapshots.snapshotScope(saved),{preset:true,worlds:true,regex:false});
});
test('empty or malformed explicit scope cannot silently fall back to restoring everything',()=>{
 for(const scope of [{preset:false,worlds:false,regex:false},{preset:true},null,{preset:'false',worlds:true,regex:true}])assert.throws(()=>snapshots.validateSnapshot({...base(),scope}),/范围/);
});
