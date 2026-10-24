// Auto-parse bindings preserve exact formatting and reject malformed persisted data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {captureSnapshotReasoning, captureFullSnapshotReasoning, normalizeSnapshotReasoning, sameSnapshotReasoning} from '../src/features/snapshot/snapshot-reasoning.js';
import {validateSnapshot, selectSnapshotScope, snapshotScope} from '../src/features/snapshot/snapshot.js';

const config={version:1,auto_parse:false,name:'自定义',prefix:'\r\n<think> ',suffix:' </think>\n',separator:'\n\n'};
const full={...config,version:2,auto_expand:false,show_hidden:true,add_to_prompts:false,max_additions:0};
test('full reasoning capture includes all native settings and preserves zero, false and whitespace',()=>{
  assert.deepEqual(captureFullSnapshotReasoning({...full,secret:'excluded'}),full);
  assert(sameSnapshotReasoning(full,full));
  assert(!sameSnapshotReasoning({...full,show_hidden:false},full));
  assert(sameSnapshotReasoning({...full,show_hidden:false},config),'v1 must still only compare its original field mask');
});
test('reasoning scope supports reasoning alone, strips deselected data and infers legacy bindings',()=>{
  const base={id:'s',name:'s',scope:{preset:false,worlds:false,regex:false,reasoning:true},entries:[],groups:[],worldNames:[],reasoning:full};
  assert.equal(validateSnapshot(base),base);
  assert.equal(snapshotScope({...base,scope:{preset:true,worlds:false,regex:false},reasoning:config}).reasoning,true);
  assert.equal(selectSnapshotScope({...base,scope:{...base.scope,preset:true,reasoning:false}}).reasoning,undefined);
  assert.throws(()=>validateSnapshot({...base,reasoning:undefined}),/推理/);
  for(const max_additions of [-1,1000,1.5,'0',NaN])assert.throws(()=>normalizeSnapshotReasoning({...full,max_additions}));
  for(const key of ['auto_expand','show_hidden','add_to_prompts'])assert.throws(()=>normalizeSnapshotReasoning({...full,[key]:undefined}));
});
test('binding preserves false and exact whitespace while excluding unrelated options',()=>{
  const saved=captureSnapshotReasoning({...config,auto_expand:true,max_additions:9,secret:'excluded'});
  assert.deepEqual(saved,config);assert.notEqual(saved,config);
  assert(sameSnapshotReasoning({...config,show_hidden:true},saved));
  assert(!sameSnapshotReasoning({...config,prefix:config.prefix.trim()},saved));
});
test('malformed reasoning records cannot silently become an active configuration',()=>{
  for(const value of [null,{}, {...config,version:2},{...config,auto_parse:'false'},{...config,suffix:null},{...config,name:42}])assert.throws(()=>normalizeSnapshotReasoning(value),/设置无效/);
});
test('old snapshots remain valid; bindings survive base scope filtering',()=>{
  const base={id:'s',name:'s',scope:{preset:false,worlds:true,regex:false},entries:[],groups:[],worldNames:[]};
  assert.equal(validateSnapshot(base),base);
  assert.deepEqual(selectSnapshotScope({...base,reasoning:config}).reasoning,config);
  assert.throws(()=>validateSnapshot({...base,reasoning:{...config,prefix:undefined}}),/自动解析/);
});
