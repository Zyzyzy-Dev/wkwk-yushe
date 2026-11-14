// 整组迁移回归：分组边界、跨侧合并、字段和来源保留。
import test from 'node:test';
import assert from 'node:assert/strict';
import { transferPresetGroup } from '../src/features/preset/group-transfer.js';
const fixture=()=>({prompts:['a','b','c','d','u'].map(identifier=>({identifier,content:identifier,extra:{keep:true}})),prompt_order:[{character_id:100001,order:['a','b','c','d','u'].map(identifier=>({identifier,enabled:identifier!=='b',extra:8}))}],extensions:{other:9,baibaiToolkit:{presetPromptGroups:{extra:10,groups:[{id:'g',name:'G',enabled:false,collapsed:true,extra:11},{id:'h',name:'H'}],prompts:{a:{groupId:'g',extra:12},b:{groupId:'g'},c:{groupId:'h'},d:{groupId:'h'}}}}}});
const ids=p=>p.prompt_order[0].order.map(x=>x.identifier||x);
test('same-side whole group sorts atomically at a boundary without mutating input',()=>{const p=fixture(),before=JSON.stringify(p);const r=transferPresetGroup(p,p,'g','u');assert.deepEqual(ids(r),['c','d','a','b','u']);assert.equal(JSON.stringify(p),before);assert.equal(r.prompts.find(x=>x.identifier==='a'),p.prompts[0]);assert.equal(r.prompt_order[0].order[3].enabled,false);assert.equal(r.extensions.other,9)});
test('rejects a landing inside another group or at a stale id',()=>{const p=fixture();assert.throws(()=>transferPresetGroup(p,p,'g','d'),/分组/);assert.throws(()=>transferPresetGroup(p,p,'g','gone'));});
test('cross side keeps originals and generates independent group/member IDs on collision',()=>{const p=fixture(),t=fixture();const before=JSON.stringify(p);const r=transferPresetGroup(p,t,'g',null);assert.deepEqual(ids(r).slice(0,5),ids(t));assert.equal(ids(r).length,7);assert.equal(new Set(ids(r)).size,7);const group=r.extensions.baibaiToolkit.presetPromptGroups.groups.find(g=>g.name==='G（1）');assert(group);assert.notEqual(group.id,'g');assert.equal(group.extra,11);const copies=r.prompts.filter(x=>!t.prompts.some(y=>y.identifier===x.identifier));assert.equal(copies.length,2);assert.deepEqual(copies.map(p=>p.content),['a','b']);assert.equal(r.extensions.baibaiToolkit.presetPromptGroups.prompts[copies[0].identifier].extra,12);assert.equal(JSON.stringify(p),before);assert.equal(r.extensions.baibaiToolkit.presetPromptGroups.prompts.a.groupId,'g');});
test('same names with different ids remain separate and uninjected members remain uninjected',()=>{const p=fixture(),t=fixture();p.prompts.push({identifier:'hidden',content:'x'});p.extensions.baibaiToolkit.presetPromptGroups.prompts.hidden={groupId:'g'};t.extensions.baibaiToolkit.presetPromptGroups.groups[1].name='G';const r=transferPresetGroup(p,t,'g','c');assert.equal(r.extensions.baibaiToolkit.presetPromptGroups.groups.length,3);assert(r.prompts.some(x=>x.identifier==='hidden'));assert(!ids(r).includes('hidden'));});


test('duplicate group names increment while a free prompt ID is retained',()=>{const p=fixture(),t=fixture();t.extensions.baibaiToolkit.presetPromptGroups.groups.push({id:'taken',name:'G（1）'});p.prompts[0].identifier='fresh';p.prompt_order[0].order[0].identifier='fresh';p.extensions.baibaiToolkit.presetPromptGroups.prompts.fresh={groupId:'g'};const r=transferPresetGroup(p,t,'g',null);assert(r.extensions.baibaiToolkit.presetPromptGroups.groups.some(g=>g.name==='G（2）'));assert(ids(r).includes('fresh'));});
test('presets without explicit order retain existing visible entries when copied or sorted',()=>{const p=fixture(),t=fixture();delete p.prompt_order;t.prompt_order=[];const r=transferPresetGroup(p,t,'g','c');assert.deepEqual(ids(r).slice(0,2),['a','b']);assert.equal(ids(r).length,7);assert(ids(r).includes('u'));const q=transferPresetGroup(p,p,'g','u');assert.deepEqual(ids(q),['c','d','a','b','u']);});

test('disabled overwrite gives colliding whole-group members numbered names and keeps target content',()=>{
  const source=fixture(),target=fixture();source.prompts[0].name='重复';source.prompts[1].name='重复';
  const before=structuredClone(target),result=transferPresetGroup(source,target,'g',null,{overwriteSameIdOnDrop:false});
  const copies=result.prompts.filter(p=>!target.prompts.some(t=>t.identifier===p.identifier));
  assert.deepEqual(copies.map(p=>p.name),['重复（1）','重复（2）']);
  assert.equal(result.prompts.find(p=>p.identifier==='a'),target.prompts[0]);
  assert.deepEqual(target,before);
});
test('disabled overwrite does not rename a group member with an unused ID or same-side sorting',()=>{
  const source=fixture(),target=fixture();source.prompts[0].identifier='fresh';source.prompts[0].name='保留';source.prompt_order[0].order[0].identifier='fresh';
  source.extensions.baibaiToolkit.presetPromptGroups.prompts.fresh={groupId:'g'};
  const result=transferPresetGroup(source,target,'g',null,{overwriteSameIdOnDrop:false});
  assert.equal(result.prompts.find(p=>p.identifier==='fresh').name,'保留');
  const sorted=transferPresetGroup(source,source,'g','u',{overwriteSameIdOnDrop:false});
  assert.equal(sorted.prompts.find(p=>p.identifier==='fresh'),source.prompts[0]);
});

test('disabled whole-group copy numbers an exact-name collision with a different ID and preserves source settings',()=>{
  const source=fixture(),target=fixture();
  source.prompts[0]={...source.prompts[0],identifier:'source-a',name:'共享名称',content:'source body'};
  source.prompt_order[0].order[0].identifier='source-a';
  source.extensions.baibaiToolkit.presetPromptGroups.prompts['source-a']={groupId:'g',extra:12};
  delete source.extensions.baibaiToolkit.presetPromptGroups.prompts.a;
  target.prompts[0].name='共享名称';target.prompts[0].content='target body';
  const before=structuredClone({source,target}),original=target.prompts[0];
  const result=transferPresetGroup(source,target,'g',null,{overwriteSameIdOnDrop:false});
  const copy=result.prompts.find(p=>p.content==='source body');
  assert(copy);assert(!['a','source-a'].includes(copy.identifier));assert.equal(copy.name,'共享名称（1）');
  assert.equal(result.prompts.find(p=>p.identifier==='a'),original);assert.equal(original.content,'target body');
  assert.deepEqual(copy.extra,{keep:true});
  assert.deepEqual(result.prompt_order[0].order.find(item=>item.identifier===copy.identifier),{identifier:copy.identifier,enabled:true,extra:8});
  const group=result.extensions.baibaiToolkit.presetPromptGroups.prompts[copy.identifier];
  assert.notEqual(group.groupId,'g');assert.equal(group.extra,12);
  assert.deepEqual({source,target},before);
});

test('whole-group numbered names reserve later free incoming names and keep uninjected copies uninjected',()=>{
  const source=fixture(),target=fixture();
  source.prompts[0]={...source.prompts[0],identifier:'source-a',name:'共享'};
  source.prompt_order[0].order[0].identifier='source-a';
  source.extensions.baibaiToolkit.presetPromptGroups.prompts['source-a']={groupId:'g'};
  delete source.extensions.baibaiToolkit.presetPromptGroups.prompts.a;
  source.prompts[1]={...source.prompts[1],identifier:'source-b',name:'共享（2）'};
  source.prompt_order[0].order[1].identifier='source-b';
  source.extensions.baibaiToolkit.presetPromptGroups.prompts['source-b']={groupId:'g'};
  delete source.extensions.baibaiToolkit.presetPromptGroups.prompts.b;
  source.prompts.push({identifier:'hidden',name:'共享',content:'hidden body'});
  source.extensions.baibaiToolkit.presetPromptGroups.prompts.hidden={groupId:'g'};
  target.prompts[0].name='共享';target.prompts[1].name='共享（1）';
  const result=transferPresetGroup(source,target,'g',null,{overwriteSameIdOnDrop:false});
  const copies=result.prompts.filter(p=>!target.prompts.some(t=>t.identifier===p.identifier));
  assert.deepEqual(copies.map(p=>p.name),['共享（3）','共享（2）','共享（4）']);
  assert.equal(copies[1].identifier,'source-b');
  const hidden=copies.find(p=>p.content==='hidden body');
  assert.notEqual(hidden.identifier,'hidden');assert(!ids(result).includes(hidden.identifier));
});

test('disabled whole-group copy only treats exact nonempty names as collisions',()=>{
  const source=fixture(),target=fixture();
  source.prompts[0].identifier='source-a';source.prompts[0].name='共享 ';
  source.prompt_order[0].order[0].identifier='source-a';
  source.extensions.baibaiToolkit.presetPromptGroups.prompts['source-a']={groupId:'g'};
  source.prompts[1].identifier='source-b';source.prompts[1].name='';
  source.prompt_order[0].order[1].identifier='source-b';
  source.extensions.baibaiToolkit.presetPromptGroups.prompts['source-b']={groupId:'g'};
  target.prompts[0].name='共享';target.prompts[1].name='';
  const result=transferPresetGroup(source,target,'g',null,{overwriteSameIdOnDrop:false});
  assert.equal(result.prompts.find(p=>p.identifier==='source-a').name,'共享 ');
  assert.equal(result.prompts.find(p=>p.identifier==='source-b').name,'');
});

test('fresh whole-group IDs avoid all role orders and source entries outside the copied group',()=>{
  const source=fixture(),target=fixture();
  source.prompts.push({identifier:'source-outside-group',content:'untouched source'});
  target.prompt_order.push({character_id:7,order:['reserved-other-order']});
  target.extensions.baibaiToolkit.presetPromptGroups.prompts['reserved-meta']={groupId:'h'};
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  const candidates=['reserved-other-order','reserved-meta','source-outside-group','valid-a','valid-b','valid-group'];
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:{randomUUID:()=>{
    assert(candidates.length,'fresh ID generation should terminate');return candidates.shift();
  }}});
  try{
    const result=transferPresetGroup(source,target,'g',null);
    const copies=result.prompts.filter(p=>!target.prompts.some(t=>t.identifier===p.identifier));
    assert.deepEqual(copies.map(p=>p.identifier),['valid-a','valid-b']);
    assert.deepEqual(result.prompt_order[1],target.prompt_order[1]);
  }finally{
    if(descriptor)Object.defineProperty(globalThis,'crypto',descriptor);else delete globalThis.crypto;
  }
});

test('a free source group ID does not capture an orphan target role or group reference',()=>{
  const source=fixture(),target=fixture();
  source.prompts[0].identifier='orphan';source.prompt_order[0].order[0].identifier='orphan';
  source.extensions.baibaiToolkit.presetPromptGroups.prompts.orphan={groupId:'g'};
  delete source.extensions.baibaiToolkit.presetPromptGroups.prompts.a;
  target.prompt_order.push({character_id:7,order:[{identifier:'orphan',enabled:false,extra:'retain'}]});
  target.extensions.baibaiToolkit.presetPromptGroups.prompts.orphan={groupId:'h',extra:'retain'};
  const result=transferPresetGroup(source,target,'g',null);
  const copy=result.prompts.find(p=>p.content==='a'&&p.identifier!=='a');
  assert(copy);assert.notEqual(copy.identifier,'orphan');
  assert.deepEqual(result.prompt_order[1],target.prompt_order[1]);
  assert.deepEqual(result.extensions.baibaiToolkit.presetPromptGroups.prompts.orphan,{groupId:'h',extra:'retain'});
});
