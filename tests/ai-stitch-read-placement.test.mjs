// 读取宏必须进入已有容器；只插入字串，不能改动既有正文。
import test from 'node:test';import assert from 'node:assert/strict';
import {insertStitchRead} from '../src/features/preset/ai-stitch/read-placement.js';
import {assembleStitch,makeStitchInput} from '../src/features/preset/ai-stitch/core.js';
test('中文容器内插入并沿用读取分隔符与CRLF',()=>{
 const before='<其他选项>\r\n说明\r\n{{getvar::a }}\r\n---\r\n{{getvar::b }}\r\n\r\n</其他选项>';
 const r=insertStitchRead(before,'{{getvar::恋爱企划}}','local');
 assert.equal(r.after,'<其他选项>\r\n说明\r\n{{getvar::a }}\r\n---\r\n{{getvar::b }}\r\n---\r\n{{getvar::恋爱企划}}\r\n\r\n</其他选项>');
 assert.equal(r.container,'其他选项');assert.equal(r.after.slice(0,r.offset)+r.after.slice(r.offset+r.inserted.length),before);
});
test('无容器保留末尾追加；嵌套容器选择读取宏直属容器',()=>{
 assert.equal(insertStitchRead('原文','{{getvar::x}}','local').after,'原文\n{{getvar::x}}');
 const r=insertStitchRead('<外><内>{{getvar::a}}</内></外>','{{getvar::x}}','local');assert.equal(r.container,'内');assert.ok(r.after.indexOf('{{getvar::x}}')<r.after.indexOf('</内>'));
});
test('多个容器必须指明，指明后仍验证存在、唯一和读取作用域',()=>{
 const text='<A>{{getvar::a}}</A><B>{{getvar::b}}</B>';
 assert.throws(()=>insertStitchRead(text,'{{getvar::x}}','local'),/多个/);
 assert.ok(insertStitchRead(text,'{{getvar::x}}','local','B').after.includes('{{getvar::b}}\n{{getvar::x}}</B>'));
 for(const [body,tag] of [[text,'C'],['<A>{{getvar::a}}</A><A>{{getvar::b}}</A>','A'],['<A>{{getglobalvar::a}}</A>','A'],['<A>{{getvar::a}}</B>','A'],['<A>{{getvar::a}}','A'],['{{if::x::<A>{{getvar::a}}</A>}}','A']])assert.throws(()=>insertStitchRead(body,'{{getvar::x}}','local',tag));
});
test('全局变量及多项依次插入保留各自位置',()=>{
 const a=insertStitchRead('<附加>{{getglobalvar::a}}</附加>','{{getglobalvar::b}}','global');
 const b=insertStitchRead(a.after,'{{getglobalvar::c}}','global');assert.ok(b.after.includes('{{getglobalvar::a}}\n{{getglobalvar::b}}\n{{getglobalvar::c}}</附加>'));
});
test('组装两材料到同一读取容器，排除材料不留宏，确认绑定容器选择',()=>{
 const baseline={prompts:[{identifier:'a',content:'{{setvar::old:: }}'},{identifier:'b',content:'<其他选项>\n{{getvar::old}}\n</其他选项>'}],prompt_order:[{character_id:100001,order:['a','b'].map(identifier=>({identifier,enabled:true}))}]};
 const input=makeStitchInput(baseline,['一','二'].map(id=>({id,name:id,content:'正文'+id})),'','session',1);
 const plan={schemaVersion:2,sessionId:'session',revision:1,items:input.sources.map(s=>({sourceId:s.id,anchorId:'a',placement:'after',role:'system',mode:'define',initId:'a',readId:'b',readTag:'其他选项',scope:'local',variable:s.id,reason:'新模块',adaptation:'保留',referenceIds:['b'],adaptedContent:s.content}))};
 const preview=assembleStitch(input,plan,new Set(),{preview:true}),approvals=new Map(preview.reviews.map(r=>[r.sourceId,r.token]));
 const saved=assembleStitch(input,plan,new Set(),{approvals});assert.equal(saved.preset.prompts.find(p=>p.identifier==='b').content,'<其他选项>\n{{getvar::old}}\n{{getvar::一}}\n{{getvar::二}}\n</其他选项>');
 const single=assembleStitch(input,plan,new Set(['二']),{approvals});assert.ok(!single.preset.prompts.find(p=>p.identifier==='b').content.includes('{{getvar::二}}'));assert.deepEqual(input.baseline,baseline);
 delete plan.items[0].readTag;assert.throws(()=>assembleStitch(input,plan,new Set(),{approvals}),/确认/);
});
