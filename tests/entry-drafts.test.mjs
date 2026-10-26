// 表单转换回归：默认显示值不产生假草稿，字段无损，保存副本不污染原对象。
import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPromptDraft,isPendingPromptDraft,buildPresetDraftSnapshot} from '../src/features/preset/entry-drafts.js';

test('unchanged form defaults are not pending and do not materialize absent properties',()=>{
  const prompt={identifier:'a',name:'Entry',content:'Text'};
  const draft={name:'Entry',role:'system',content:'Text',trigger:'',injection_position:'0',injection_depth:'4',injection_order:'100'};
  assert.equal(isPendingPromptDraft(prompt,draft),false);
  assert.deepEqual(applyPromptDraft(prompt,draft),prompt);
  assert.equal(isPendingPromptDraft(prompt,undefined),false);
});
test('editing text preserves hidden metadata, absent fields and a multi trigger selection',()=>{
  const prompt={identifier:'a',content:'before',injection_trigger:['normal','continue'],extension:{nested:[1,2]}};
  const next=applyPromptDraft(prompt,{content:'after',trigger:'normal'});
  assert.equal(next.content,'after');assert.deepEqual(next.injection_trigger,['normal','continue']);
  assert.deepEqual(next.extension,prompt.extension);assert.notEqual(next.extension,prompt.extension);
  assert.equal(prompt.content,'before');assert.equal('role' in next,false);
  assert.equal(isPendingPromptDraft(prompt,{content:'before',trigger:'normal'}),false);
  assert.equal(isPendingPromptDraft(prompt,{content:'after',trigger:'normal'}),true);
});
test('changing displayed trigger explicitly changes its selection and unknown imported values survive no-op',()=>{
  const prompt={identifier:'a',injection_trigger:['normal','continue']};
  assert.deepEqual(applyPromptDraft(prompt,{trigger:'swipe'}).injection_trigger,['swipe']);
  assert.deepEqual(applyPromptDraft(prompt,{trigger:''}).injection_trigger,[]);
  const future={identifier:'b',injection_trigger:['future-trigger']};
  assert.deepEqual(applyPromptDraft(future,{trigger:'',content:'new'}).injection_trigger,['future-trigger']);
});
test('chat positions retain zero numeric values and relative mode leaves hidden values intact',()=>{
  const prompt={identifier:'a',injection_position:0,injection_depth:9,injection_order:10};
  const next=applyPromptDraft(prompt,{injection_position:'1',injection_depth:'0',injection_order:'0'});
  assert.equal(next.injection_position,1);assert.equal(next.injection_depth,0);assert.equal(next.injection_order,0);
  assert.deepEqual(applyPromptDraft(prompt,{injection_position:'0',injection_depth:'4',injection_order:'100'}),prompt);
});
test('preset draft snapshot includes only object-associated drafts and is detached at every level',()=>{
  const preset={prompts:[{identifier:'a',content:'old'},{identifier:'b',content:'other'}],extensions:{keep:[1]},prompt_order:[{order:[{identifier:'a',enabled:false}]}]};
  const drafts=new WeakMap([[preset.prompts[0],{content:'new'}],[{identifier:'b'},{content:'foreign'}]]);
  const snapshot=buildPresetDraftSnapshot(preset,drafts);
  assert.equal(snapshot.prompts[0].content,'new');assert.equal(snapshot.prompts[1].content,'other');
  assert.equal(preset.prompts[0].content,'old');snapshot.extensions.keep.push(2);assert.deepEqual(preset.extensions.keep,[1]);
  assert.deepEqual(snapshot.prompt_order,preset.prompt_order);
});
