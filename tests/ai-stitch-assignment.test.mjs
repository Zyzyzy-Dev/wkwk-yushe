// 宏按prompt_order准备，聊天深度不改变变量求值顺序；已有变量赋值须明确确认。
import test from 'node:test';import assert from 'node:assert/strict';
import {assembleStitch,makeStitchInput,stitchContext} from '../src/features/preset/ai-stitch/core.js';
function fixture(){
 const baseline={prompts:[{identifier:'init',content:'{{setvar::header:: }}'},{identifier:'old',content:'{{setvar::header::old}}',injection_position:1,injection_depth:3},{identifier:'read',content:'{{getvar::header}}'}],prompt_order:[{character_id:100001,order:['init','old','read'].map(identifier=>({identifier,enabled:true}))}]};
 const input=makeStitchInput(baseline,[{id:'s',name:'新顶栏',content:'<header>new {{user}}</header>'}],'','s',1);
 const item={sourceId:'s',anchorId:'old',placement:'after',mode:'assign',variable:'header',scope:'local',role:'system',reason:'替代原格式',adaptedContent:input.sources[0].content,referenceIds:['old'],adaptation:'沿用同功能变量'};
 return {input,item,plan:{schemaVersion:2,sessionId:'s',revision:1,items:[item]}};
}
test('已有变量新set在旧set后get前，原条目完整保留；即使正文一致也要确认',()=>{
 const {input,plan}=fixture(),r=assembleStitch(input,plan,new Set(),{preview:true});
 assert.equal(r.reviews[0].needsApproval,true);assert.throws(()=>assembleStitch(input,plan),/确认/);
 const saved=assembleStitch(input,plan,new Set(),{approvals:new Map([['s',r.reviews[0].token]])});
 assert.equal(saved.added[0].content,'{{setvar::header::<header>new {{user}}</header>}}');
 assert.deepEqual(saved.preset.prompts.filter(p=>p.identifier!==saved.added[0].id),input.baseline.prompts);
 assert.equal(stitchContext(input).baseline.prompts[1].variableIssue,null);
});
test('赋值不能在读取之后、后续重置之前、无已有变量时或有条件依赖时保存',()=>{
 for(const edit of [f=>f.item.anchorId='read',f=>f.item.anchorId='init',f=>f.item.variable='missing',f=>f.input.baseline.prompts[1].injection_trigger=['normal'],f=>f.input.baseline.prompts[1].content='<%x%>{{setvar::header::old}}']){
  const f=fixture();edit(f);assert.throws(()=>assembleStitch(f.input,f.plan,new Set(),{preview:true}));
 }
});
test('聊天深度普通宏也允许追加；未知注入类型仍拒绝',()=>{
 const f=fixture();f.item.mode='append';assert.equal(assembleStitch(f.input,f.plan,new Set(),{preview:true}).added[0].content,'{{addvar::header::'+f.item.adaptedContent+'}}');
 f.input.baseline.prompts[1].injection_position=7;assert.throws(()=>assembleStitch(f.input,f.plan));
});
test('已有赋值不能被旧add改变，自身读取不能伪装完整替代',()=>{
 const f=fixture();f.input.baseline.prompts[2].content='{{addvar::header::old extra}}{{getvar::header}}';assert.throws(()=>assembleStitch(f.input,f.plan,new Set(),{preview:true}),/旧追加/);
 f.input.baseline.prompts[2].content='{{getvar::header}}';f.item.adaptedContent='{{getvar::header}}';assert.throws(()=>assembleStitch(f.input,f.plan,new Set(),{preview:true}),/自身/);
});
test('全局变量赋值使用独立作用域，确认绑定完整方案',()=>{
 const f=fixture();for(const p of f.input.baseline.prompts)p.content=p.content.replaceAll('setvar','setglobalvar').replaceAll('getvar','getglobalvar');f.item.scope='global';
 const r=assembleStitch(f.input,f.plan,new Set(),{preview:true});assert.ok(r.added[0].content.startsWith('{{setglobalvar::header::'));
 const approvals=new Map([['s',r.reviews[0].token]]);f.item.placement='before';assert.throws(()=>assembleStitch(f.input,f.plan,new Set(),{approvals}),/确认/);
});
