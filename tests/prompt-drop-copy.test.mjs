// 跨预设拖入规划：唯一同名可覆盖，碰撞副本避重，整批决策不改来源或目标。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as drop from '../src/features/preset/prompt-drop-copy.js';
const {createSameIdDropCopy}=drop;
const plan=(...args)=>drop.planPromptDrops(...args);
const preset=(...prompts)=>({prompts});
const entry=(identifier,name,content=identifier,extra={})=>({identifier,name,content,...extra});
const serialId=()=>{let n=0;return()=>`fresh-${++n}`;};

const prompt=()=>({identifier:'same',name:'角色要求',content:'source text',role:'system',enabled:false,unknown:{nested:['retained']}});
test('disabled overwrite creates an independent named copy without mutating either preset',()=>{
  const source=prompt(),target={prompts:[{identifier:'same',name:'新版名称',content:'keep target'}]},before=structuredClone({source,target});
  const copy=createSameIdDropCopy(source,target,false);
  assert.notEqual(copy.identifier,source.identifier);assert.equal(copy.name,'角色要求（1）');
  assert.equal(copy.content,'source text');assert.equal(copy.enabled,false);assert.deepEqual(copy.unknown,source.unknown);
  copy.unknown.nested.push('copy only');assert.deepEqual({source,target},before);
});
test('successive copies choose the first unused numbered name',()=>{
  const source=prompt(),target={prompts:[{identifier:'same',name:'角色要求'},{identifier:'taken',name:'角色要求（2）'}]};
  const first=createSameIdDropCopy(source,target,false);target.prompts.push(first);
  const next=createSameIdDropCopy(source,target,false);target.prompts.push(next);
  assert.equal(first.name,'角色要求（1）');assert.equal(next.name,'角色要求（3）');
  assert.equal(new Set(target.prompts.map(p=>p.identifier)).size,4);
});
test('default overwrite and an unrelated free source ID do not request a duplicate',()=>{
  const source=prompt();
  assert.equal(createSameIdDropCopy(source,{prompts:[source]}),null);
  assert.equal(createSameIdDropCopy(source,{prompts:[source]},true),null);
  assert.equal(createSameIdDropCopy(source,{prompts:[{identifier:'other',name:'其他名称'}]},false),null);
});
test('disabled compatibility helper copies a same-name entry even when IDs differ',()=>{
  const source=prompt(),target=preset(entry('other',source.name));
  const copy=createSameIdDropCopy(source,target,false,()=> 'fresh');
  assert.equal(copy.identifier,'fresh');assert.equal(copy.name,'角色要求（1）');
});
test('fresh IDs avoid dangling order references and metadata as well as existing prompts',()=>{
  const source=prompt(),target={prompts:[source],prompt_order:[{order:[{identifier:'order-only'},'string-order']}],extensions:{baibaiToolkit:{presetPromptGroups:{prompts:{'group-only':{}}}}}};
  const candidates=['same','order-only','string-order','group-only','fresh'];
  const copy=createSameIdDropCopy(source,target,false,()=>candidates.shift());
  assert.equal(copy.identifier,'fresh');
});

test('unique exact name with different IDs overwrites using the destination ID and clones source content',()=>{
  const original=entry('old','角色要求','new body',{enabled:false,unknown:{keep:['yes']}}),targetEntry=entry('new','角色要求','target body');
  const source=preset(original),target=preset(targetEntry),before=structuredClone({source,target});
  const r=plan(source,target,['old']).get('old');
  assert.equal(r.action,'overwrite');assert.equal(r.reason,null);assert.equal(r.prompt.identifier,'new');assert.equal(r.prompt.name,'角色要求');assert.equal(r.prompt.content,'new body');
  r.prompt.unknown.keep.push('copy');assert.deepEqual({source,target},before);
});

test('safe same-ID match remains eligible while an unconfirmed same ID creates a numbered copy',()=>{
  const source=preset(entry('same','角色要求','source')),target=preset(entry('same','角色要求','target'));
  const safe=plan(source,target,['same'],{counterpartId:()=> 'same'}).get('same');
  assert.equal(safe.action,'overwrite');assert.equal(safe.prompt.identifier,'same');assert.equal(safe.reason,null);
  const unsafe=plan(source,target,['same'],{counterpartId:()=>null,createId:()=> 'copy'}).get('same');
  assert.equal(unsafe.action,'copy');assert.equal(unsafe.prompt.identifier,'copy');assert.equal(unsafe.prompt.name,'角色要求（1）');assert.equal(unsafe.reason,'unsafe-id');
});

test('disabled overwrite creates a new ID and first unused suffix on name collision without mutating the target',()=>{
  const source=preset(entry('source','角色要求')),target=preset(entry('target','角色要求'),entry('suffix','角色要求（1）'));
  const before=structuredClone(target),r=plan(source,target,['source'],{overwriteSameIdOnDrop:false,createId:()=> 'copy'}).get('source');
  assert.equal(r.action,'copy');assert.equal(r.reason,null);assert.equal(r.prompt.identifier,'copy');assert.equal(r.prompt.name,'角色要求（2）');assert.deepEqual(target,before);
});

test('duplicate source names do not overwrite even when only one source entry was selected',()=>{
  const source=preset(entry('a','重复'),entry('b','重复')),target=preset(entry('target','重复'));
  const r=plan(source,target,['a'],{createId:()=> 'copy'}).get('a');
  assert.equal(r.action,'copy');assert.equal(r.reason,'duplicate-name');assert.equal(r.prompt.name,'重复（1）');assert.notEqual(r.prompt.identifier,'target');
});

test('duplicate source names create a copy on raw ID collision even when the reliable target was renamed',()=>{
  const source=preset(entry('same','重复','source'),entry('other','重复','another source')),target=preset(entry('same','已改名','keep'));
  const before=structuredClone({source,target}),r=plan(source,target,['same'],{counterpartId:()=> 'same',createId:()=> 'copy'}).get('same');
  assert.equal(r.action,'copy');assert.equal(r.reason,'duplicate-name');assert.equal(r.prompt.name,'重复（1）');assert.equal(r.prompt.identifier,'copy');assert.deepEqual({source,target},before);
});

test('duplicate destination names do not select the first match or rely on an ID to resolve the ambiguity',()=>{
  const source=preset(entry('same','重复')),target=preset(entry('same','重复'),entry('second','重复'));
  const r=plan(source,target,['same'],{counterpartId:()=> 'same',createId:()=> 'copy'}).get('same');
  assert.equal(r.action,'copy');assert.equal(r.reason,'duplicate-name');assert.equal(r.prompt.identifier,'copy');
});

test('a raw ID and an exact name pointing to different destinations preserve both targets',()=>{
  const source=preset(entry('slot','角色要求')),target=preset(entry('slot','其他设置'),entry('name-match','角色要求'));
  const r=plan(source,target,['slot'],{counterpartId:()=> 'slot',createId:()=> 'copy'}).get('slot');
  assert.equal(r.action,'copy');assert.equal(r.reason,'id-name-conflict');assert.equal(r.prompt.identifier,'copy');assert.equal(r.prompt.name,'角色要求（1）');
  const redirected=plan(source,target,['slot'],{counterpartId:()=> 'name-match',createId:()=> 'another-copy'}).get('slot');
  assert.equal(redirected.action,'copy');assert.equal(redirected.reason,'id-name-conflict');
});

test('marker entries and ordinary prompts never overwrite one another by ID or name',()=>{
  const source=preset(entry('source','角色要求','body',{marker:true}));
  for(const identifier of ['source','other']){
    const target=preset(entry(identifier,'角色要求','keep',{marker:false}));
    const r=plan(source,target,['source'],{counterpartId:()=>identifier,createId:()=> 'copy'}).get('source');
    assert.equal(r.action,'copy');assert.equal(r.reason,'type-mismatch');assert.equal(r.prompt.identifier,'copy');assert.equal(r.prompt.marker,true);
  }
});

test('exact names are not trimmed, normalized, or fuzzily matched and blank names are not candidates',()=>{
  for(const [a,b] of [['角色要求',' 角色要求'],['角色 要求','角色  要求'],['é','e\u0301'],['',''],['  ','  ']]){
    const r=plan(preset(entry('source',a)),preset(entry('target',b)),['source']).get('source');
    assert.equal(r.action,'insert');assert.equal(r.prompt.identifier,'source');assert.equal(r.prompt.name,a);assert.equal(r.reason,null);
  }
});

test('an unoccupied ID and name insert without renaming and only valid selected IDs are planned',()=>{
  const source=preset(entry('source','角色要求')),target=preset(entry('target','其他名称'));
  const results=plan(source,target,['missing','source','source']);
  assert.deepEqual([...results.keys()],['source']);assert.equal(results.get('source').action,'insert');assert.equal(results.get('source').prompt.identifier,'source');
  assert.notEqual(results.get('source').prompt,source.prompts[0]);
});

test('fresh IDs avoid all source/target prompt IDs, dangling orders and group metadata',()=>{
  const source=preset(entry('source','角色要求'),entry('source-reserved','保留'));
  source.prompt_order=[{order:['source-order']}];source.extensions={baibaiToolkit:{presetPromptGroups:{prompts:{'source-group':{}}}}};
  const target=preset(entry('target','角色要求'));
  target.prompt_order=[{order:[{identifier:'target-order'},'string-order']}];target.extensions={baibaiToolkit:{presetPromptGroups:{prompts:{'target-group':{}}}}};
  const candidates=['source','source-reserved','source-order','source-group','target','target-order','string-order','target-group','fresh'];
  const r=plan(source,target,['source'],{overwriteSameIdOnDrop:false,createId:()=>candidates.shift()}).get('source');
  assert.equal(r.prompt.identifier,'fresh');
});

test('a free prompt ID reserved by destination order or metadata is copied instead of capturing its references',()=>{
  const source=preset(entry('reserved','角色要求')),target=preset();target.prompt_order=[{order:['reserved']}];
  const r=plan(source,target,['reserved'],{createId:()=> 'fresh'}).get('reserved');
  assert.equal(r.action,'copy');assert.equal(r.reason,'reserved-id');assert.equal(r.prompt.identifier,'fresh');
});

test('batch decisions use the original names and never overwrite the same target twice',()=>{
  const source=preset(entry('a','共同名称','A'),entry('target','改名','B')),target=preset(entry('target','共同名称','keep'));
  const r=plan(source,target,['a','target'],{counterpartId:id=>id==='target'?'target':null,createId:serialId()});
  assert.equal(r.get('a').action,'overwrite');assert.equal(r.get('a').prompt.identifier,'target');
  assert.equal(r.get('target').action,'copy');assert.equal(r.get('target').reason,'target-claimed');assert.notEqual(r.get('target').prompt.identifier,'target');
  assert.equal(target.prompts[0].content,'keep');assert.equal(source.prompts[1].content,'B');
});

test('batch suffixes avoid each other and names of later free inserts',()=>{
  const source=preset(entry('a','重复'),entry('b','重复'),entry('free','重复（1）')),target=preset(entry('target','重复'));
  const r=plan(source,target,['a','b','free'],{overwriteSameIdOnDrop:false,createId:serialId()});
  assert.deepEqual([...r.values()].map(x=>x.prompt.name),['重复（2）','重复（3）','重复（1）']);
  assert.equal(r.get('free').action,'insert');assert.equal(new Set([...r.values()].map(x=>x.prompt.identifier)).size,3);
});
