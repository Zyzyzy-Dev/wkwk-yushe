// 标签误报回归：正文提及不污染结构栈，等价随机路径不挤掉跨条目开合。
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkPresetStructure} from '../src/features/preset/syntax-check.js';
const run=texts=>{const entries=texts.map((text,i)=>({id:String(i),name:String(i),text}));return checkPresetStructure({entries,streams:[{fragments:entries.map(e=>({type:'source',entryId:e.id,start:0,end:e.text.length}))}],uncertainties:[]});};
const tags=result=>result.issues.filter(i=>i.code.startsWith('tag-'));
test('inline mentions do not create crossings or duplicate standalone openings',()=>{
 assert.deepEqual(tags(run(['<section>\n说明中的 <topic> 和 <section> 是标签名。','</section>'])),[]);
 assert.deepEqual(tags(run(['以<world>标签里的内容为背景，之后提到<world>。\n<world>','</world>'])),[]);
 assert.deepEqual(tags(run(['<world>标签里的内容属于示例。'])),[]);
});
test('standalone, tag-only and clearly wrapped inline markup still participates',()=>{
 assert.equal(tags(run(['  <section>  \r\n正文','</section>'])).length,0);
 assert.ok(tags(run(['<a><b>','</a></b>'])).some(i=>i.code==='tag-crossing'));
 assert.ok(tags(run(['<a>\n内容\n<b>\n正文\n</a>'])).some(i=>i.code==='tag-unclosed'&&i.message.includes('b')&&i.related));
 assert.deepEqual(tags(run(['<a>内容<b>正文</a>'])),[]);
 assert.deepEqual(tags(run(['<a>内容</a>'])),[]);
 assert.ok(tags(run(['<open>'])).some(i=>i.code==='tag-unclosed'));
});
test('random argument boundaries are checked as their own source regions',()=>{
 assert.ok(tags(run(['{{random::<a>::</a>}}'])).length>0);
 assert.deepEqual(tags(run(['<a>','{{random::说明中提到 <other>::普通内容}}','</a>'])),[]);
});
test('plain random alternatives do not exhaust the structural path budget',()=>{
 const r=run(['<a>',Array(12).fill('{{random::alpha::beta::gamma}}').join('\n')+'\n</a>']);
 assert.deepEqual(tags(r),[]);assert.equal(r.coverage,'complete');
});
test('branch overflow preserves the unconditional opening and closing around a skipped variant',()=>{
 const varying=Array.from({length:5},(_,i)=>`{{random::<a${i}></a${i}>::<b${i}></b${i}>}}`).join('\n');
 const r=run([`<outer>\n<section>\n${varying}`,`<inner>\n{{random::<a></a>::<b></b>}}\n</inner>\n</section>`,'</outer>']);
 assert.equal(r.coverage,'partial');
 assert.equal(tags(r).some(i=>i.message.includes('outer')||i.message.includes('section')),false);
});
test('only tags alone on their line need closing; viewer order and chat history',()=>{
 assert.deepEqual(tags(run(['<boundless_world>','以<boundless_world>标签包裹的为故事根基，<boundless_world>里面的内容。','</boundless_world>'])),[]);
 assert.deepEqual(tags(run(['<details><summary>剧情选项</summary>\nA. 选项\n</details>'])),[]);
 assert.deepEqual(tags(run(['<Tone>{{getvar::style}}','{{//说明}} </Tone>'])),[]);
 const mention=tags(run(['依据<bkgd_info>与设定','</bkgd_info>']));assert.equal(mention.length,1);assert.equal(mention[0].severity,'review');
 const entries=[{id:'a',name:'a',text:'<ECoT>'}];const r=checkPresetStructure({entries,streams:[{fragments:[{type:'source',entryId:'a',afterChat:true}]}],uncertainties:[]});
 assert.equal(tags(r)[0].severity,'review');assert.match(tags(r)[0].message,/聊天记录之后/);
 assert.equal(tags(run(['<open>']))[0].severity,'error');
});
test('crossing is reported once and inner unclosed points at the outer closer',()=>{
 const r=tags(run(['<a>\n<b>','</a>\n</b>']));assert.equal(r.length,1);assert.equal(r[0].code,'tag-crossing');
 const u=tags(run(['<outer>\n<inner>','</outer>']));assert.equal(u.length,1);assert.equal(u[0].code,'tag-unclosed');assert.match(u[0].message,/<\/outer>/);
});
