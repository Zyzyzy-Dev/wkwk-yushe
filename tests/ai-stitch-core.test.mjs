// 组装器拒绝模型越权、严格保留原文与已有字段，并验证变量执行顺序。
import test from 'node:test';import assert from 'node:assert/strict';
import { assembleStitch, makeStitchInput, previewStitchSource, stitchAnchorIssue, stitchContext } from '../src/features/preset/ai-stitch/core.js';
const base=()=>({unknown:{keep:1},prompts:[{identifier:'a',name:'定义',content:'{{setvar::tone::}}',role:'system'},{identifier:'b',name:'读取',content:'前\r\n{{getvar::tone}} 后',role:'system'}],prompt_order:[{character_id:100001,order:[{identifier:'a',enabled:true},{identifier:'b',enabled:true}]}],extensions:{baibaiToolkit:{presetPromptGroups:{groups:[{id:'g',name:'组',enabled:true}],prompts:{a:{groupId:'g'},b:{groupId:'g'}}}},regex_scripts:[{x:1}]}});
const input=(content=' \r\n中文😀\n{{user}}\r\n ' )=>makeStitchInput(base(),[{id:'s',name:'来源',content}], '指导','session',1);
const plan=(i,extra={})=>({schemaVersion:1,sessionId:i.sessionId,revision:i.revision,items:[{sourceId:'s',anchorId:'a',placement:'after',groupId:'g',mode:'direct',role:'system',reason:'相关',...extra}]});
test('锚点阻止原因区分禁用、分组、聊天位置和触发器，发送同一诊断',()=>{
 for(const [edit,pattern] of [[i=>i.baseline.prompts[0].enabled=false,/条目已禁用/],[i=>i.baseline.extensions.baibaiToolkit.presetPromptGroups.groups[0].enabled=false,/分组已禁用/],[i=>i.baseline.prompts[0].injection_position=1,/聊天中/],[i=>i.baseline.prompts[0].injection_trigger=['normal'],/触发条件.*normal/]]){const i=input();edit(i);assert.match(stitchAnchorIssue(i.baseline,'a'),pattern);assert.match(stitchContext(i).baseline.prompts[0].anchorIssue,pattern);assert.throws(()=>assembleStitch(i,plan(i)),pattern);}
});
test('单项包裹可展示但不绕过整套方案顺序校验',()=>{const i=input(),p=plan(i,{mode:'append',scope:'local',variable:'tone',anchorId:'b'});assert.equal(previewStitchSource(i.sources[0],p.items[0]),'{{addvar::tone::'+i.sources[0].content+'}}');assert.throws(()=>assembleStitch(i,p));});
test('超过20万字符仍完整保留，不静默截断',()=>{const content='中文😀\r\n '.repeat(40000);const i=input(content);assert.equal(i.sources[0].content,content);const r=assembleStitch(i,plan(i));assert.equal(r.added[0].content,content);});
test('多种 Unicode/CRLF/嵌套宏原文与非目标字段逐字保留',()=>{const i=input(),before=structuredClone(i);const r=assembleStitch(i,plan(i));assert.equal(r.preset.prompts.find(p=>!['a','b'].includes(p.identifier)).content,i.sources[0].content);assert.deepEqual(r.preset.prompts.filter(p=>['a','b'].includes(p.identifier)),i.baseline.prompts);assert.deepEqual(r.preset.unknown,{keep:1});assert.deepEqual(r.preset.extensions.regex_scripts,[{x:1}]);assert.deepEqual(i,before);});
test('模型不能提供正文、未知ID、重复或遗漏材料、任意补丁',()=>{const i=input();for(const mutate of [p=>p.items[0].content='改写',p=>p.items[0].anchorId='fake',p=>p.items.push({...p.items[0]}),p=>p.items=[],p=>p.patch={}]){const p=plan(i);mutate(p);assert.throws(()=>assembleStitch(i,p));}});
test('addvar使用本地原文包裹且已有正文不变',()=>{const i=input();const r=assembleStitch(i,plan(i,{mode:'append',variable:'tone',scope:'local'}));assert.equal(r.preset.prompts[1].content,'{{addvar::tone::'+i.sources[0].content+'}}');assert.deepEqual(r.preset.prompts[2],i.baseline.prompts[1]);});
test('变量读前定义、禁用组、边界混淆、同名定义被拒绝',()=>{let i=input();assert.throws(()=>assembleStitch(i,plan(i,{mode:'append',variable:'tone',scope:'local',anchorId:'b'})));i=input('unbalanced }}');assert.throws(()=>assembleStitch(i,plan(i,{mode:'append',variable:'tone',scope:'local'})));i=input();i.baseline.extensions.baibaiToolkit.presetPromptGroups.groups[0].enabled=false;assert.throws(()=>assembleStitch(i,plan(i)));i=input();assert.throws(()=>assembleStitch(i,plan(i,{mode:'define',variable:'tone',scope:'local',readId:'b'})));});
test('定义新变量仅追加白名单读取宏，已有字串保持前缀完全一致',()=>{const i=input();const r=assembleStitch(i,plan(i,{mode:'define',variable:'new_tone',scope:'local',readId:'b'}));assert.equal(r.preset.prompts[2].content,i.baseline.prompts[1].content+'\r\n{{getvar::new_tone}}');assert.equal(r.changes.length,1);});
test('来源变量缺依赖不可默默修复，来源 set 不覆盖现有变量',()=>{for(const content of ['{{getvar::missing}}','{{setvar::tone::overwrite}}']){const i=input(content);assert.throws(()=>assembleStitch(i,plan(i)));}});
test('多个同锚点材料保持输入顺序且ID唯一，取消材料不保存',()=>{const i=input();i.sources.push({id:'s2',name:'重名',content:'第二'});const p=plan(i);p.items.push({...p.items[0],sourceId:'s2'});let r=assembleStitch(i,p);assert.deepEqual(r.preset.prompts.slice(1,3).map(x=>x.content),[i.sources[0].content,'第二']);assert.equal(new Set(r.preset.prompts.map(x=>x.identifier)).size,4);r=assembleStitch(i,p,new Set(['s2']));assert.equal(r.preset.prompts.length,3);});
test('会话修订不匹配和待处理项阻止保存',()=>{const i=input();assert.throws(()=>assembleStitch(i,{...plan(i),revision:2}));assert.throws(()=>assembleStitch(i,plan(i,{mode:'pending',reason:'无合适位置'})));});
test('追加后被重新定义覆盖、条件依赖、嵌套变量定义均拒绝',()=>{
 let i=input();i.baseline.prompts[1].content='{{setvar::tone::reset}}{{getvar::tone}}';assert.throws(()=>assembleStitch(i,plan(i,{mode:'append',scope:'local',variable:'tone'})));
 i=input('{{getvar::tone}}');i.baseline.prompts[0].injection_trigger=['normal'];assert.throws(()=>assembleStitch(i,plan(i,{anchorId:'b',placement:'before'})));
 i=input('{{getvar::tone}}');i.baseline.prompts[0].content='{{if::x::{{setvar::tone::x}}}}';assert.throws(()=>assembleStitch(i,plan(i)));
});
test('来源条件写入和定义自身读取不被当作无条件初始化',()=>{
 for(const content of ['{{if::false::{{setvar::fresh::x}}}}{{getvar::fresh}}','<% if(false){ %>{{setvar::fresh::x}}<% } %>{{getvar::fresh}}']){const i=input(content);assert.throws(()=>assembleStitch(i,plan(i)));}
 const i=input('{{getvar::fresh}}');assert.throws(()=>assembleStitch(i,plan(i,{mode:'define',variable:'fresh',scope:'local',readId:'b'})));
});

test('未执行的备用变量条目不阻断追加，原对象和开关全部保留',()=>{
 for(const state of ['unlisted','rowDisabled','promptDisabled','groupDisabled']){
  const i=input(),b=i.baseline;
  b.prompts.push({identifier:'unused',name:'备用思维',content:'<% if(x){ %>{{setvar::tone::备用}}{{getvar::tone}}<% } %>',injection_position:1,injection_trigger:['normal']});
  if(state!=='unlisted')b.prompt_order[0].order.push({identifier:'unused',enabled:state!=='rowDisabled'});
  if(state==='promptDisabled')b.prompts.at(-1).enabled=false;
  if(state==='groupDisabled'){const g=b.extensions.baibaiToolkit.presetPromptGroups;g.groups.push({id:'off',name:'备用组',enabled:false});g.prompts.unused={groupId:'off'};}
  const before=structuredClone(b),r=assembleStitch(i,plan(i,{mode:'append',scope:'local',variable:'tone'}));
  assert.equal(r.added[0].content,'{{addvar::tone::'+i.sources[0].content+'}}');
  assert.deepEqual(r.preset.prompts.filter(p=>p.identifier!==r.added[0].id),before.prompts);
  assert.deepEqual(r.preset.prompt_order[0].order.filter(p=>p.identifier!==r.added[0].id),before.prompt_order[0].order);
  assert.deepEqual(i.baseline,before);
 }
});
test('禁用定义或读取不能充当有效依赖，备用名字仍参与新变量冲突检查',()=>{
 for(const id of ['a','b']){const i=input();i.baseline.prompt_order[0].order.find(p=>p.identifier===id).enabled=false;assert.throws(()=>assembleStitch(i,plan(i,{anchorId:id==='a'?'b':'a',mode:'append',scope:'local',variable:'tone'})));}
 const i=input();i.baseline.prompts.push({identifier:'unused',name:'备用',content:'{{setvar::new_tone::}}'});assert.throws(()=>assembleStitch(i,plan(i,{mode:'define',scope:'local',variable:'new_tone',readId:'b'})),/变量名冲突/);
});
test('实际执行的条件和聊天位置依赖仍阻止保存，并指明变量和条目',()=>{
 for(const [settings,reason] of [[{injection_trigger:['normal']},'触发条件'],[{injection_position:1,injection_depth:4,injection_order:100},'聊天中']]){
  const i=input();Object.assign(i.baseline.prompts[1],settings);
  assert.throws(()=>assembleStitch(i,plan(i,{mode:'append',scope:'local',variable:'tone'})),e=>e.message.includes('local tone')&&e.message.includes('getvar')&&e.message.includes('读取')&&e.message.includes(reason));
 }
});

test('导入显示按连续分组段保留原顺序，不聚合跨组的未分组条目',async()=>{
 const {stitchEntrySections}=await import('../src/features/preset/ui/ai-stitch-panel.js');
 const items=['','g','','h','g','g',''].map((groupId,i)=>({sourceId:String(i),groupId,content:'原文'+i}));
 const sections=stitchEntrySections(items);assert.deepEqual(sections.map(s=>s.items.map(i=>i.sourceId)),[['0'],['1'],['2'],['3'],['4','5'],['6']]);assert.deepEqual(sections.flatMap(s=>s.items),items);assert.equal(new Set(sections.map(s=>s.key)).size,6);
});

test('Phase/Step格式与变量可组合，材料字符和CRLF不改写，预览与保存一致',()=>{
 const i=input('人格校验\r\n\r\n人格一致性校验😀\r\n这一轮{{user}}是否符合原有特质？');
 i.baseline.prompts[0].content+='\n## Phase 【认知边界】\n### Step 1. 范例';
 const format={lines:[{line:1,style:'phase'},{line:3,style:'step'}]},p=plan(i,{mode:'append',scope:'local',variable:'tone',format});
 const before=structuredClone(i),r=assembleStitch(i,p);
 assert.equal(r.added[0].content,'{{addvar::tone::## Phase 【人格校验】\r\n\r\n### Step 1. 人格一致性校验😀\r\n这一轮{{user}}是否符合原有特质？}}');
 assert.equal(previewStitchSource(i.sources[0],p.items[0],i.baseline),r.added[0].content);assert.deepEqual(i,before);
 assert.deepEqual(r.preset.prompts.filter(x=>['a','b'].includes(x.identifier)),i.baseline.prompts);
});
test('格式方案不能改写、越界、重复包装或臆造目标模板',()=>{
 for(const format of [{content:'篡改'},{lines:[{line:0,style:'heading2'}]},{lines:[{line:1,style:'phase'}]},{lines:[{line:1,style:'heading2'},{line:1,style:'heading3'}]},{lines:[{line:1,style:'rewrite'}]},{tag:'script'},{lines:[{line:1,style:'heading2',text:'改写'}]}]){
  const i=input('标题');assert.throws(()=>assembleStitch(i,plan(i,{format})));
 }
 for(const content of ['## 已有标题','{{user}}','<tag>','```js','  ']){const i=input(content);assert.throws(()=>assembleStitch(i,plan(i,{format:{lines:[{line:1,style:'heading2'}]}})));}
});
test('标签只复制目标中已有配对结构，不执行模板，改锚点后重新校验',()=>{
 const i=input('正文\r\n{{user}}');i.baseline.prompts[0].content+='\n<思考>示例</思考>';
 const p=plan(i,{format:{tag:'思考'}});assert.equal(assembleStitch(i,p).added[0].content,'<思考>\n正文\r\n{{user}}\n</思考>');
 p.items[0].anchorId='b';assert.throws(()=>assembleStitch(i,p),/目标标签/);
});
