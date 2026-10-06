// 完整模型正文、逐项确认与组装保护的回归；不调用真实模型或酒馆。
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeStitchInput,assembleStitch,previewStitchSource,parseStitchResponse,STITCH_INSTRUCTIONS} from '../src/features/preset/ai-stitch/core.js';
import {reviewStitchItem} from '../src/features/preset/ai-stitch/review.js';
import {createStitchSession} from '../src/features/preset/ai-stitch/session.js';
const fixture=()=>{
 const base={prompts:[{identifier:'a',name:'思考定义',content:'{{setvar::thought::}}'},{identifier:'b',name:'思考读取',content:'{{getvar::thought}}'}],prompt_order:[{character_id:100001,order:[{identifier:'a',enabled:true},{identifier:'b',enabled:true}]}]};
 const input=makeStitchInput(base,[{id:'s',name:'材料',content:'动机\r\n保留{{user}}的目标😀'}],'参考同功能分区','session',1);
 const item={sourceId:'s',anchorId:'a',placement:'after',groupId:null,mode:'direct',role:'system',reason:'同功能',referenceIds:['a','b'],adaptation:'改为目标的结构',adaptedContent:'<reasoning>\n- 动机\n- 保留{{user}}的目标😀\n</reasoning>'};
 return {input,item,plan:{schemaVersion:2,sessionId:'session',revision:1,items:[item]}};
};
test('通用格式完整正文可预览，未确认禁止保存，确认后不改旧条目或材料',()=>{
 const {input,item,plan}=fixture(),before=structuredClone(input);
 const result=assembleStitch(input,plan,new Set(),{preview:true});assert.equal(result.reviews[0].needsApproval,true);
 assert.equal(result.added[0].content,item.adaptedContent);assert.equal(previewStitchSource(input.sources[0],item,input.baseline),item.adaptedContent);
 assert.throws(()=>assembleStitch(input,plan),/确认正文变化/);
 const saved=assembleStitch(input,plan,new Set(),{approvals:new Map([['s',result.reviews[0].token]])});
 assert.equal(saved.added[0].content,item.adaptedContent);assert.deepEqual(saved.preset.prompts.filter(p=>p.identifier==='a'||p.identifier==='b'),input.baseline.prompts);assert.deepEqual(input,before);
});
test('不信任AI声称仅格式，删改重排及空白变化均需确认',()=>{
 for(const text of ['动机','保留{{user}}的目标😀\r\n动机','动机\n保留{{user}}的目标😀','新增规则\r\n动机\r\n保留{{user}}的目标😀']){
  const {input,item}=fixture();item.adaptedContent=text;item.adaptation='保证只改格式';assert.equal(reviewStitchItem(input,item).needsApproval,true);
 }
});
test('完全一致和Markdown结构仍分类保留，但方案均需人工确认',()=>{
 const {input,item,plan}=fixture();item.adaptedContent=input.sources[0].content;assert.equal(reviewStitchItem(input,item).kind,'unchanged');assert.throws(()=>assembleStitch(input,plan),/确认/);assembleStitch(input,plan,new Set(),{approvals:new Map([['s',reviewStitchItem(input,item).token]])});
 item.adaptedContent='## 动机\r\n- 保留{{user}}的目标😀';assert.equal(reviewStitchItem(input,item).kind,'structure');assert.throws(()=>assembleStitch(input,plan),/确认/);assembleStitch(input,plan,new Set(),{approvals:new Map([['s',reviewStitchItem(input,item).token]])});
});
test('确认绑定原文/整个方案/会话修订，任一变更后不能沿用',()=>{
 for(const change of [x=>x.item.adaptedContent+='改',x=>x.item.anchorId='b',x=>x.item.placement='before',x=>x.input.sources[0].content+='改',x=>{x.input.revision++;x.plan.revision++;},x=>{x.input.sessionId='new';x.plan.sessionId='new';}]){
  const x=fixture(),approvals=new Map([['s',reviewStitchItem(x.input,x.item).token]]);change(x);assert.throws(()=>assembleStitch(x.input,x.plan,new Set(),{approvals}),/确认正文变化/);
 }
});
test('模型不能返回已确认字段；旧schema不能夹带完整正文；新schema不能省略正文',()=>{
 const x=fixture();x.item.approved=true;assert.throws(()=>assembleStitch(x.input,x.plan),/未知字段/);delete x.item.approved;
 x.plan.schemaVersion=1;assert.throws(()=>assembleStitch(x.input,x.plan),/未知字段/);x.plan.schemaVersion=2;delete x.item.adaptedContent;assert.throws(()=>assembleStitch(x.input,x.plan),/完整的适配正文/);
});
test('已确认仍检查格式参考、宏括号、脚本、未知宏及变量执行',()=>{
 for(const change of [x=>x.item.referenceIds=['missing'],x=>x.item.adaptedContent='<% run() %>',x=>x.item.adaptedContent='{{user}',x=>x.item.adaptedContent='{{run::code}}']){
  const x=fixture();change(x);assert.throws(()=>assembleStitch(x.input,x.plan,new Set(),{preview:true}));
 }
 for(const text of ['{{getvar::missing}}','{{setvar::thought::覆盖}}','{{addvar::missing::追加}}']){
  const x=fixture();x.item.adaptedContent=text;const approvals=new Map([['s',reviewStitchItem(x.input,x.item).token]]);assert.throws(()=>assembleStitch(x.input,x.plan,new Set(),{approvals}));
 }
});
test('变量包裹使用适配后的正文，不重复套原文；嵌套写入仍拒绝',()=>{
 const x=fixture();Object.assign(x.item,{mode:'append',variable:'thought',scope:'local'});
 const approvals=new Map([['s',reviewStitchItem(x.input,x.item).token]]),r=assembleStitch(x.input,x.plan,new Set(),{approvals});assert.equal(r.added[0].content,'{{addvar::thought::'+x.item.adaptedContent+'}}');
 x.item.adaptedContent='{{setvar::other::不允许}}';assert.throws(()=>assembleStitch(x.input,x.plan,new Set(),{preview:true}),/写入/);
});
test('完整正文超过旧10万字符可解析；非法/旧协议回包仍拒绝',()=>{
 const x=fixture();x.item.adaptedContent='长文'.repeat(60000);assert.equal(parseStitchResponse(JSON.stringify(x.plan),2).items[0].adaptedContent.length,120000);
 assert.throws(()=>parseStitchResponse('{',2),/合法JSON/);assert.throws(()=>parseStitchResponse('{"schemaVersion":1}',2),/新版正文方案/);assert.match(STITCH_INSTRUCTIONS,/多个相关条目/);
});
test('取消或失败恢复上次方案及确认；成功新方案和输入修改清除旧确认',()=>{
 const s=createStitchSession({side:'old',name:'主',baseline:{}});s.plan={items:['旧']};s.approvals.set('s','old');s.excluded.add('x');s.begin();s.cancel();assert.deepEqual(s.plan,{items:['旧']});assert.equal(s.approvals.get('s'),'old');assert(s.excluded.has('x'));
 const token=s.begin();s.accept(token,{items:['新']});assert.equal(s.approvals.size,0);s.approvals.set('s','new');s.touch();assert.equal(s.approvals.size,0);assert.equal(s.plan,null);
});
test('新条目改名参与确认且不改来源名称、正文或已有条目',()=>{
 const x=fixture(),before=structuredClone(x.input),approval=reviewStitchItem(x.input,x.item).token;
 x.item.name='自定义名称';assert.throws(()=>assembleStitch(x.input,x.plan,new Set(),{approvals:new Map([['s',approval]])}),/确认正文变化/);
 const r=assembleStitch(x.input,x.plan,new Set(),{approvals:new Map([['s',reviewStitchItem(x.input,x.item).token]])});
 assert.equal(r.preset.prompts[1].name,'自定义名称');assert.equal(r.preset.prompts[1].content,x.item.adaptedContent);assert.deepEqual(x.input,before);
 x.item.name=' ';assert.throws(()=>assembleStitch(x.input,x.plan,new Set(),{preview:true}),/名称不能为空/);
});
