// 临时库副本、转换及对象身份回归；纯合成材料，不依赖酒馆。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/features/worldbook/temp-library.js';
const entry = () => ({source:'酒馆：演示',key:'x',name:'材料',content:'原文\r\n<script>不执行</script>',enabled:false,role:1});
const preset = () => ({prompts:[{identifier:'a',name:'A',content:'A',custom:{ok:1}},{identifier:'b',name:'B',content:'B'}],prompt_order:[{character_id:100001,order:[{identifier:'a',enabled:true},{identifier:'b',enabled:true}]}],extensions:{regex_scripts:[{scriptName:'R',findRegex:'a'}],baibaiToolkit:{presetPromptGroups:{groups:[{id:'g',name:'G'}],prompts:{a:{groupId:'g'}}}}}});
test('library snapshots are isolated and duplicate collection keeps the first version',()=>{
 assert.equal(typeof api.createTempLibrarySession,'function');const s=api.createTempLibrarySession(),e=entry();
 assert.deepEqual(api.addTempLibraryEntries(s,[e],{keepDisabled:true}),{added:1,skipped:0});e.content='changed';
 const item=[...s.items.values()][0];assert.equal(item.content,'原文\r\n<script>不执行</script>');assert.equal(item.enabled,false);
 assert.deepEqual(api.addTempLibraryEntries(s,[e],{}),{added:0,skipped:1});assert.equal(item.content,'原文\r\n<script>不执行</script>');
 assert.equal(api.addTempLibraryEntries(s,[{...e,source:'文件：演示.json'}],{keepDisabled:false}).added,1);assert.equal([...s.items.values()][1].enabled,true);
 assert.equal(api.createTempLibrarySession().items.size,0);
});
test('invalid batch leaves the library untouched',()=>{
 const s=api.createTempLibrarySession();assert.throws(()=>api.addTempLibraryEntries(s,[entry(),{source:'x',key:'bad'}]));assert.equal(s.items.size,0);
});
test('insertion preserves existing prompt and regex identities, source and unknown data',()=>{
 const p=preset(),before=JSON.stringify(p),e=entry(),r=api.prepareTempLibraryInsert(p,e,{afterId:'a'});
 assert.equal(JSON.stringify(p),before);assert.equal(r.preset.prompts[0],p.prompts[0]);assert.equal(r.preset.prompts[2],p.prompts[1]);assert.equal(r.preset.extensions.regex_scripts,p.extensions.regex_scripts);
 const added=r.preset.prompts[1];assert.equal(added.content,e.content);assert.equal(added.enabled,false);assert.equal(added.role,'user');assert.equal(r.preset.extensions.baibaiToolkit.presetPromptGroups.prompts[added.identifier].groupId,'g');
 assert.deepEqual(r.preset.prompt_order[0].order.map(x=>x.identifier),['a',added.identifier,'b']);
 const again=api.prepareTempLibraryInsert(r.preset,e,{placement:'end',groupId:''});assert.notEqual(again.identifiers[0],added.identifier);assert.equal(again.preset.extensions.baibaiToolkit.presetPromptGroups.prompts[again.identifiers[0]],undefined);
});
test('explicit empty group overrides anchor inheritance and explicit group can target an empty group',()=>{
 const p=preset();let r=api.prepareTempLibraryInsert(p,entry(),{afterId:'a',groupId:''});assert.equal(r.preset.extensions.baibaiToolkit.presetPromptGroups.prompts[r.identifiers[0]],undefined);
 r=api.prepareTempLibraryInsert(p,entry(),{placement:'end',groupId:'g'});assert.equal(r.preset.extensions.baibaiToolkit.presetPromptGroups.prompts[r.identifiers[0]].groupId,'g');
});
test('invalid anchor or group rejects without partial mutations',()=>{
 const p=preset(),before=JSON.stringify(p);assert.throws(()=>api.prepareTempLibraryInsert(p,entry(),{beforeId:'missing'}));assert.throws(()=>api.prepareTempLibraryInsert(p,entry(),{groupId:'missing'}));assert.equal(JSON.stringify(p),before);
});
test('an empty loaded preset accepts a first independent prompt',()=>{
 const p={prompts:[],prompt_order:[]};const r=api.prepareTempLibraryInsert(p,entry(),{placement:'end',groupId:''});assert.equal(r.preset.prompts.length,1);assert.equal(p.prompts.length,0);assert.equal(r.preset.prompt_order[0].order[0].identifier,r.identifiers[0]);
});
test('an empty group without a membership map accepts a dropped material',()=>{
 const p={prompts:[],prompt_order:[],extensions:{baibaiToolkit:{presetPromptGroups:{groups:[{id:'g',name:'空组'}]}}}};
 const r=api.prepareTempLibraryInsert(p,entry(),{placement:'end',groupId:'g'});
 assert.equal(r.preset.extensions.baibaiToolkit.presetPromptGroups.prompts[r.identifiers[0]].groupId,'g');
 assert.equal(p.extensions.baibaiToolkit.presetPromptGroups.prompts,undefined);
});
