// 设置快照纯功能回归：两层开关、节点隔离、引用匹配和绑定优先级。
import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSnapshot, planSnapshotRestore, resolveSnapshotBinding, validateSnapshot } from '../src/snapshot.js';
import * as snapshots from '../src/snapshot.js';
const settings = () => ({prompts:[{identifier:'a',name:'A',content:'current'},{identifier:'b',name:'B'}],prompt_order:[{character_id:7,order:[{identifier:'a',enabled:false}]},{character_id:100001,order:[{identifier:'a',enabled:true},{identifier:'b',enabled:false}]}]});
const groups = () => ({groups:[{id:'g',name:'组',enabled:false}],prompts:{a:{groupId:'g'},b:{groupId:'g'}}});
const capture = (extra={}) => captureSnapshot({id:'s',name:' 快照 ',presetName:'预设',settings:settings(),orderCharacterId:100001,groupState:groups(),worldNames:['书'],now:123,...extra});

test('snapshot display follows current editor order including ungrouped and repeated group segments',()=>{
 const current=settings();current.prompts=['u','b','a','v','c'].map(identifier=>({identifier,name:identifier}));
 current.prompt_order[1].order=['u','b','v','a','c'].map(identifier=>({identifier,enabled:true}));
 const gs={groups:[{id:'g1',name:'First'},{id:'g2',name:'Second'}],prompts:{a:{groupId:'g1'},b:{groupId:'g2'},c:{groupId:'g2'}}};
 const saved=captureSnapshot({name:'s',presetName:'p',settings:current,orderCharacterId:100001,groupState:gs,worldNames:[]});
 saved.entries.reverse();const before=JSON.stringify(saved);
 const view=snapshots.snapshotPresetEditor(saved,current,gs);
 const sections=snapshots.snapshotPresetSections(saved.entries,saved.groups,view.entries);
 assert.deepEqual(sections.map(s=>[s.groupId,s.entries.map(e=>e.identifier)]),[[null,['u']],['g2',['b']],[null,['v']],['g1',['a']],['g2',['c']]]);
 assert.equal(JSON.stringify(saved),before);
 assert.equal(sections[1].entries[0],saved.entries.find(e=>e.identifier==='b'));
});

test('editor display resolves live membership and content without adding either to persisted switches',()=>{
 const saved=capture(), current=settings();current.prompts[0].content='Latest body';
 const view=snapshots.snapshotPresetEditor(saved,current,groups());
 assert.equal(view.entries[0].content,'Latest body');assert.equal(view.entries[0].groupId,'g');
 assert.deepEqual(view.groups[0].memberIds,['a','b']);
 assert.equal(saved.entries[0].groupId,undefined);assert.equal(saved.entries[0].content,undefined);
 current.prompts=[];
 assert.equal(snapshots.snapshotPresetEditor(saved,current,groups()).entries[0].missing,true);
});

test('display keeps missing entries and empty groups without mutating an incomplete preset',()=>{
 const saved=capture(),current={prompts:[{identifier:'b',name:'B'}]},before=JSON.stringify(current);
 const view=snapshots.snapshotPresetEditor(saved,current,{groups:[]});
 const sections=snapshots.snapshotPresetSections(saved.entries,saved.groups,view.entries);
 assert.deepEqual(sections.map(s=>[s.groupId,s.entries.map(e=>e.identifier)]),[[null,['b','a']],['g',[]]]);
 assert.equal(JSON.stringify(current),before);
 assert.equal(view.entries.find(e=>e.identifier==='a').missing,true);
});
test('capture keeps independent group and item switches, excluding content and other nodes',()=>{
 const s=capture();assert.equal(s.name,'快照');assert.deepEqual(s.entries,[{identifier:'a',name:'A',enabled:true},{identifier:'b',name:'B',enabled:false}]);assert.deepEqual(s.groups,[{id:'g',name:'组',enabled:false}]);assert.equal(s.entries[0].content,undefined);
});
test('restore plans both layers independently for all switch combinations',()=>{
 for(const group of [false,true])for(const entry of [false,true]){const src=settings();src.prompt_order[1].order[0].enabled=entry;const gs=groups();gs.groups[0].enabled=group;const s=capture({settings:src,groupState:gs});const current=settings();current.prompts[0].content='new text';const before=JSON.stringify(current);const p=planSnapshotRestore(s,{settings:current,orderCharacterId:100001,groupState:groups(),worldNames:['书']});assert.equal(p.entries[0].enabled,entry);assert.equal(p.groups[0].enabled,group);assert.equal(JSON.stringify(current),before)}
});
test('restore matches IDs, skips missing entries and leaves new entries alone',()=>{
 const current=settings();current.prompt_order[1].order=[{identifier:'a',enabled:false},{identifier:'new',enabled:true}];const p=planSnapshotRestore(capture(),{settings:current,orderCharacterId:100001,groupState:{groups:[]},worldNames:[]});assert.deepEqual(p.entries,[{identifier:'a',enabled:true}]);assert.deepEqual(p.missingEntries,['B']);assert.deepEqual(p.missingGroups,['组']);assert.deepEqual(p.missingWorldNames,['书']);assert.deepEqual(p.worldNames,[]);
});
test('node mismatch and ambiguous duplicate nodes are rejected',()=>{
 assert.throws(()=>planSnapshotRestore(capture(),{settings:settings(),orderCharacterId:7,groupState:groups(),worldNames:['书']}));const s=settings();s.prompt_order.push(structuredClone(s.prompt_order[1]));assert.throws(()=>capture({settings:s}));
});
test('empty global mount list is a valid restore, malformed lists and booleans are rejected',()=>{
 const s=capture({worldNames:[],groupState:null});assert.deepEqual(planSnapshotRestore(s,{settings:settings(),orderCharacterId:100001,groupState:null,worldNames:['书']}).worldNames,[]);assert.throws(()=>capture({worldNames:null}));assert.throws(()=>validateSnapshot({...s,entries:[{identifier:'a',enabled:'false'}]}));assert.throws(()=>capture({name:'  '}));
});
test('deleted chat snapshot falls back to character, chat binding wins, none is inert',()=>{
 const a=capture(),b=capture({id:'b'});const store={snapshots:[a,b],characterBindings:{'a.png':'b'}};assert.equal(resolveSnapshotBinding(store,'s','a.png').source,'chat');assert.equal(resolveSnapshotBinding(store,'deleted','a.png').snapshot.id,'b');assert.equal(resolveSnapshotBinding(store,null,'none'),null);
});
