// 变量编辑回归：原文保真、范围隔离、嵌套位置、批量初始化及过期预览原子拒绝。
import test from 'node:test';
import assert from 'node:assert/strict';
import {unreferencedVariableChoices, scanVariables, makeVariable, collectVariables, planVariableAdd, planVariableEdit, planVariableRename, planVariableInitializers, missingVariableInitializers, applyVariableChanges} from '../src/features/preset/variables.js';
const p = (identifier, content) => ({identifier,name:identifier,content,custom:{keep:true}});
test('扫描局部/全局 set add get，保留嵌套宏完整原文和重复出现位置', () => {
 const text='前\r\n{{setvar:: 风 ::A{{getvar::人}}B}}后{{addvar::风::雨}} {{getglobalvar::风}} {{addvar;;错误:: }}';
 const items=scanVariables(text);
 assert.deepEqual(items.map(m=>[m.kind,m.name,m.value]),[['setvar','风','A{{getvar::人}}B'],['getvar','人',''],['addvar','风','雨'],['getglobalvar','风','']]);
 for(const m of items) assert.equal(text.slice(m.start,m.end),m.raw);
 assert.equal(collectVariables([p('a',text)]).length,3);
});
test('批量追加不改原文/配置，精确重复跳过，支持空正文', () => {
 const input=[p('a','正文\r\n尾部'),p('b','')];
 const changes=planVariableAdd(input,['a','b','a'],{kind:'addvar',name:'文风',value:' '});
 const result=applyVariableChanges(input,changes);
 assert.equal(result[0].content,'正文\r\n尾部\r\n{{addvar::文风:: }}');
 assert.equal(result[1].content,'{{addvar::文风:: }}');
 assert.equal(input[0].content,'正文\r\n尾部');assert.deepEqual(result[0].custom,{keep:true});
 assert.deepEqual(planVariableAdd(result,['a','b'],{kind:'addvar',name:'文风',value:' '}),[]);
});
test('整段转换保留正文空白及嵌套宏，不允许 get 或未闭合正文', () => {
 const input=[p('a','\r\n内容{{getvar::角色}}\r\n')];
 assert.equal(planVariableAdd(input,['a'],{mode:'wrap',kind:'setvar',name:'文风'})[0].after,'{{setvar::文风::\r\n\r\n\r\n内容{{getvar::角色}}\r\n}}');
 assert.throws(()=>planVariableAdd(input,['a'],{mode:'wrap',kind:'getvar',name:'风'}),/不能存放/);
 assert.throws(()=>planVariableAdd([p('a','bad}}')],['a'],{mode:'wrap',kind:'setvar',name:'风'}),/未配对/);
 assert.throws(()=>makeVariable('setvar','a::b'),/变量名/);
 assert.throws(()=>makeVariable('setvar','风','末尾}'),/边界混淆/);
});
test('整段转换在宏头与正文之间空一行，局部全局 set/add 均保留原正文', () => {
 for(const kind of ['setvar','addvar','setglobalvar','addglobalvar']) {
  const source=[p('a','## Step 本色校验\n\n正文')];
  const result=planVariableAdd(source,['a'],{mode:'wrap',kind,name:'本色校验'})[0].after;
  assert.equal(result,'{{'+kind+'::本色校验::\n\n## Step 本色校验\n\n正文}}');
  assert.equal(source[0].content,'## Step 本色校验\n\n正文');
 }
});
test('只编辑同名多次出现中的指定位置，其他文本不变', () => {
 const input=[p('a','{{addvar::风::一}}\r\n{{addvar::风::二}}')];
 const target=scanVariables(input[0].content)[1];
 assert.equal(planVariableEdit(input,'a',target,{kind:'getvar',name:'新风',value:'无用'})[0].after,'{{addvar::风::一}}\r\n{{getvar::新风}}');
 assert.throws(()=>planVariableEdit([p('a',' changed')],'a',target,{kind:'getvar',name:'风'}),/位置已变化/);
});
test('批量重命名涵盖嵌套定义和引用，仅修改指定作用域且拒绝撞名', () => {
 const input=[p('a','{{setvar:: 风 ::{{getvar::风}}}}\n{{addvar::风::x}}\n{{getglobalvar::风}}')];
 assert.equal(planVariableRename(input,'local','风','新风')[0].after,'{{setvar:: 新风 ::{{getvar::新风}}}}\n{{addvar::新风::x}}\n{{getglobalvar::风}}');
 assert.throws(()=>planVariableRename([...input,p('b','{{getvar::新风}}')],'local','风','新风'),/已存在/);
 assert.equal(planVariableRename([p('a','{{getvar::风}}')],'local','风','$&')[0].after,'{{getvar::$&}}');
});
test('多个 addvar 来源去重补 setvar，全局分离且保留目标已有值', () => {
 const input=[p('target','{{setvar::已有::保持}}'),p('a','{{addvar::文风::A}}'),p('b','{{addvar::文风::B}}{{addglobalvar::文风::G}}{{getvar::只读}}')];
 assert.equal(missingVariableInitializers(input,'target').length,2);
 const changes=planVariableInitializers(input,'target');
 assert.equal(changes[0].after,'{{setvar::已有::保持}}\n{{setvar::文风:: }}\n{{setglobalvar::文风:: }}');
 const updated=applyVariableChanges(input,changes);
 assert.deepEqual(planVariableInitializers(updated,'target'),[]);
 assert.equal(updated[1].content,input[1].content);
});
test('过期预览、重复目标及系统占位条目均原子拒绝，不部分修改', () => {
 const input=[p('a','A'),p('b','B')], plan=planVariableAdd(input,['a','b'],{kind:'getvar',name:'风'});
 input[1].content='external';
 assert.throws(()=>applyVariableChanges(input,plan),/预览后/);assert.equal(input[0].content,'A');
 assert.throws(()=>planVariableAdd([{...p('m',''),marker:true}],['m'],{kind:'getvar',name:'风'}),/占位/);
 assert.throws(()=>applyVariableChanges([p('a','A')],[plan[0],plan[0]]),/预览后/);
});

test('引用候选与初始化条目一致，按作用域去重并忽略未注入条目的读取', () => {
 const prompts=[p('init','{{setvar::爱意:: }}{{setvar::爱意:: }}{{setglobalvar::爱意:: }}{{setvar::已用:: }}'),p('a','{{getvar::已用}}'),p('hidden','{{getvar::爱意}}'),p('other','{{setvar::不在初始化中::x}}')];
 assert.deepEqual(unreferencedVariableChoices(prompts,id=>id!=='hidden').map(v=>v.macro),['{{getvar::爱意}}','{{getglobalvar::爱意}}']);
 prompts[1].content+='{{getvar::爱意}}';
 assert.deepEqual(unreferencedVariableChoices(prompts,id=>id!=='hidden').map(v=>v.macro),['{{getglobalvar::爱意}}']);
 assert.deepEqual(unreferencedVariableChoices([p('empty','正文')]),[]);
});
