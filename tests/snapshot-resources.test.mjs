// 快照资源回归：世界书配置和正则按稳定标识恢复，不改正文、不混淆来源或原地修改输入。
import test from 'node:test';
import assert from 'node:assert/strict';
import {captureWorldEntries, restoreWorldEntries, captureRegexSwitches, restoreRegexSwitches, validateSnapshotResources} from '../src/snapshot-resources.js';
import * as resources from '../src/snapshot-resources.js';

test('new resources have only global books; legacy migration drops attached books and display content', () => {
  const legacy={worlds:{global:['G'],character:['C'],chat:['T']},worldEntries:['G','C','T'].map(name=>({name,entries:[{uid:'0',name:'entry',content:'display only',settings:{disable:false}}]})),regex:{global:[],preset:[],character:[]}};
  const migrated=resources.normalizeSnapshotResources(legacy);
  assert.deepEqual(migrated.worlds,{global:['G']});
  assert.deepEqual(migrated.worldEntries,[{name:'G',entries:[{uid:'0',name:'entry',settings:{disable:false}}]}]);
  assert.equal(migrated.version,2);
  assert.equal(migrated.regexGroups,undefined);
  assert.equal(validateSnapshotResources(migrated),migrated);
  assert.deepEqual(legacy.worlds.character,['C']);
  assert.throws(()=>validateSnapshotResources({...migrated,worlds:{global:['G'],character:['C']}}));
});

test('regex groups batch-toggle only current members, expose mixed state and never mutate sources', () => {
  const entries=[{id:'a',enabled:true},{id:'b',enabled:false},{id:'outside',enabled:true}];
  assert.deepEqual(resources.regexGroupState(entries,['a','b']),{checked:false,mixed:true,count:2,enabled:1});
  const result=resources.toggleRegexGroup(entries,['a','b'],false);
  assert.deepEqual(result.map(e=>e.enabled),[false,false,true]);
  assert.deepEqual(entries.map(e=>e.enabled),[true,false,true]);
  assert.deepEqual(resources.toggleRegexGroup(result,['a','b'],true).map(e=>e.enabled),[true,true,true]);
  assert.equal(resources.regexGroupState(entries,[]).checked,false);
});
test('regex editor reads current membership without persisting group gates or expressions', () => {
  const scripts=[{id:'a',scriptName:'A',disabled:false,findRegex:'latest'},{id:'b',disabled:true}];
  const state={groups:[{id:'g',name:'Group'}],scripts:{a:{groupId:'g'}}};
  const view=resources.regexEditor(scripts,state);
  assert.deepEqual(view.groups[0].memberIds,['a']);
  assert.equal(view.entries[0].findRegex,'latest');
  assert.equal(state.groups[0].enabled,undefined);
});

test('world entry snapshot restores complete settings by UID while preserving current content and new entries', () => {
  const saved = captureWorldEntries('书', {entries:{0:{uid:0,comment:'旧名',content:'旧正文',disable:true,constant:false,vectorized:true,key:['key'],position:4,depth:7,order:99,probability:35,extensions:{future:1}}}});
  assert.equal(saved.entries[0].settings.content, undefined);
  const current = {entries:{0:{uid:0,comment:'新名',content:'新正文',disable:false,constant:true,vectorized:false,key:[],position:0,depth:1,order:1,newOption:3},1:{uid:1,content:'新增',disable:false}}};
  const result = restoreWorldEntries(saved,current);
  assert.deepEqual(result.missing,[]);
  assert.deepEqual(result.data.entries[0],{uid:0,comment:'新名',content:'新正文',disable:true,constant:false,vectorized:true,key:['key'],position:4,depth:7,order:99,newOption:3,probability:35,extensions:{future:1}});
  assert.equal(result.data.entries[1].content,'新增');
  assert.equal(current.entries[0].disable,false);
  result.data.entries[0].key.push('extra'); assert.deepEqual(saved.entries[0].settings.key,['key']);
});
test('missing world entries are reported and ambiguous UID records are refused', () => {
  const saved = captureWorldEntries('书',{entries:{0:{uid:0,comment:'条目',disable:false}}});
  assert.deepEqual(restoreWorldEntries(saved,{entries:{}}).missing,['条目']);
  assert.throws(()=>captureWorldEntries('书',{entries:{a:{uid:0},b:{uid:0}}}));
});
test('regex switches match stable IDs with independent sources and retain latest expression', () => {
  const saved=captureRegexSwitches([{id:'a',scriptName:'旧名',disabled:true,findRegex:'old'}]);
  const source=[{id:'a',scriptName:'新名',disabled:false,findRegex:'new'},{id:'b',disabled:true}];
  const result=restoreRegexSwitches(saved,source);
  assert.equal(result.scripts[0].disabled,true); assert.equal(result.scripts[0].findRegex,'new'); assert.equal(result.scripts[1].disabled,true); assert.equal(source[0].disabled,false);
  assert.deepEqual(restoreRegexSwitches(saved,[]).missing,['旧名']);
  assert.equal(new Set(captureRegexSwitches([{id:'a'},{id:'a'}]).map(row=>row.id)).size,2);
});
test('resources validate empty mounts but reject invalid scopes, content injection and unsafe keys', () => {
  const base={worlds:{global:[],character:[],chat:[]},worldEntries:[],regex:{global:[],preset:[],character:[]}};
  assert.equal(validateSnapshotResources(base),base);
  assert.throws(()=>validateSnapshotResources({...base,worlds:{...base.worlds,chat:['a','b']}}));
  const book={name:'书',entries:[{uid:'0',name:'条目',settings:{disable:false}}]};
  const withBook={...base,worlds:{...base.worlds,global:['书']},worldEntries:[book]};
  assert.equal(validateSnapshotResources(withBook),withBook);
  for(const settings of [{content:'overwrite'},{disable:'false'},JSON.parse('{"__proto__":{"polluted":true}}')]) assert.throws(()=>validateSnapshotResources({...withBook,worldEntries:[{...book,entries:[{...book.entries[0],settings}]}]}));
  assert.throws(()=>validateSnapshotResources({...withBook,worldEntries:[]}));
});

test('legacy regex IDs tolerate duplicates and missing names without mutating sources or confusing reordered definitions', () => {
  const scripts=[{id:'same',scriptName:'A',findRegex:'a',disabled:true},{id:'same',scriptName:'B',findRegex:'b',disabled:false},{findRegex:'anonymous',disabled:true},{scriptName:'legacy',findRegex:'one'},{scriptName:'legacy',findRegex:'two',disabled:true},{id:'stable',findRegex:'old'}];
  const original=structuredClone(scripts),saved=captureRegexSwitches(scripts);
  assert.equal(new Set(saved.map(row=>row.id)).size,6);
  assert.equal(saved[5].id,'stable');assert.deepEqual(scripts,original);
  const current=scripts.toReversed().map(script=>({...script,disabled:false}));current[0].findRegex='new';
  const restored=restoreRegexSwitches(saved,current);
  assert.deepEqual(restored.missing,[]);
  assert.deepEqual(restored.scripts.map(script=>script.disabled),[false,true,false,true,false,true]);
  assert.equal(restored.scripts[0].findRegex,'new');
  const view=resources.regexEditor(current,null,saved);
  assert.deepEqual(view.entries.map(entry=>entry.findRegex),['a','b','anonymous','one','two','new']);
  assert(view.entries.every(entry=>!entry.missing));
  assert.equal(restoreRegexSwitches(saved,[{...scripts[0],disabled:false}]).scripts[0].disabled,true);
  // An old ambiguous ID must not arbitrarily select one of the conflicting records.
  assert.deepEqual(restoreRegexSwitches([{id:'same',name:'old',enabled:false}],scripts).missing,['old']);
});

test('identical legacy definitions keep distinct switches; changed multiplicity is reported missing', () => {
  const scripts=[{id:'dup',findRegex:'x',disabled:true},{id:'dup',findRegex:'x',disabled:false}];
  const saved=captureRegexSwitches(scripts);
  const result=restoreRegexSwitches(saved,scripts.map(script=>({...script,disabled:false})));
  assert.deepEqual(result.scripts.map(script=>script.disabled),[true,false]);
  assert.equal(restoreRegexSwitches(saved,[scripts[0]]).missing.length,2);
  assert(saved.every(row=>!JSON.stringify(row).includes('findRegex')));
});