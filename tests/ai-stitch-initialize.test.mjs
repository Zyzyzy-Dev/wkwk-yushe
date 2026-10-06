// 新变量的初始化、正文赋值及读取必须作为同一项原子组装。
import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleStitch as assemble,makeStitchInput} from '../src/features/preset/ai-stitch/core.js';
const assembleStitch=(input,plan,excluded=new Set(),options={})=>assemble(input,plan,excluded,{preview:true,...options});
function fixture(scope='local'){
 const suffix=scope==='global'?'globalvar':'var';
 const baseline={prompts:[{identifier:'init',name:'获取变量',content:`初始\r\n{{set${suffix}::已有:: }}`},{identifier:'read',name:'思考读取',content:`{{get${suffix}::已有}}`}],prompt_order:[{character_id:100001,order:[{identifier:'init',enabled:true},{identifier:'read',enabled:true}]}]};
 const input=makeStitchInput(baseline,[{id:'s',name:'人物思考',content:'完整正文\r\n{{user}}😀'}],'','s',1);
 const item={sourceId:'s',anchorId:'init',placement:'after',mode:'define',role:'system',reason:'新功能',variable:'人物思考',scope,initId:'init',readId:'read',adaptedContent:input.sources[0].content,referenceIds:['init','read'],adaptation:'保留正文'};
 return {input,plan:{schemaVersion:2,sessionId:'s',revision:1,items:[item]},item,suffix};
}
for(const scope of ['local','global'])test(scope+' 新变量三处联动，保留原文及原对象',()=>{
 const {input,plan,suffix}=fixture(scope),before=structuredClone(input),r=assembleStitch(input,plan);
 assert.deepEqual(input,before);
 assert.equal(r.preset.prompts[0].content,input.baseline.prompts[0].content+`\r\n{{set${suffix}::人物思考:: }}`);
 assert.equal(r.added[0].content,`{{set${suffix}::人物思考::${input.sources[0].content}}}`);
 assert.equal(r.preset.prompts[2].content,input.baseline.prompts[1].content+`\n{{get${suffix}::人物思考}}`);
 assert.deepEqual(r.changes.map(c=>c.kind),['initialize','read']);
});
test('新版缺初始化位置必须提示重新生成',()=>{const {input,plan,item}=fixture();delete item.initId;assert.throws(()=>assembleStitch(input,plan),/初始化/);});
test('初始化必须是可靠的现有同作用域变量条目且先于正文，正文先于读取',()=>{
 for(const edit of [f=>f.item.initId='read',f=>f.item.placement='before',f=>f.item.readId='init',f=>f.input.baseline.prompts[0].enabled=false,f=>f.input.baseline.prompts[0].injection_trigger=['normal'],f=>f.input.baseline.prompts[0].content='{{if::x::{{setvar::已有:: }}}}',f=>f.input.baseline.prompts[1].content='<% if(x){ %>x<% } %>',f=>f.input.baseline.prompts[0].content+='\n{{broken']){
  const f=fixture();edit(f);assert.throws(()=>assembleStitch(f.input,f.plan));
 }
});
test('多个不同新变量共享初始化条目，排除材料时三处一起撤销；同名仍拒绝',()=>{
 const {input,plan,item}=fixture();input.sources.push({...input.sources[0],id:'s2'});plan.items.push({...item,sourceId:'s2',variable:'行动思考'});
 const r=assembleStitch(input,plan);assert.equal(r.changes.length,4);assert.equal(r.added.length,2);
 const one=assembleStitch(input,plan,new Set(['s2']));assert.equal(one.changes.length,2);assert.ok(!JSON.stringify(one.preset).includes('行动思考'));
 plan.items[1].variable=item.variable;assert.throws(()=>assembleStitch(input,plan),/冲突/);
});
test('新名不能覆盖已有名，程序生成初始化不能放开正文内重复定义',()=>{
 let f=fixture();f.item.variable='已有';assert.throws(()=>assembleStitch(f.input,f.plan),/冲突/);
 f=fixture();f.item.adaptedContent='{{setvar::其他::x}}';assert.throws(()=>assembleStitch(f.input,f.plan,new Set(),{preview:true}),/写入/);
});
