// 条目身份、独立侧索引、异常候选与迁移锚点：仅使用合成预设。
import test from 'node:test';
import assert from 'node:assert/strict';
import {comparePromptPairs} from '../src/features/preset/prompt-pairs.js';
import {planMigration} from '../src/features/preset/migration.js';
const preset=(...rows)=>({prompts:rows.map(([identifier,name,content,marker=false])=>({identifier,name,content,marker})),prompt_order:[{character_id:100001,order:rows.map(([identifier])=>({identifier,enabled:true}))}]});
const old=preset(['1','甲','甲的正文'],['2','乙','乙的正文'],['3','丙','原来的段落']);
const newer=preset(['1','新项目','新版独有'],['2','甲','甲的正文'],['3','乙','乙的正文'],['4','丙','作者重写']);
test('recycled chain: bidirectional lookup and independent statuses despite identical raw keys',()=>{
 const r=comparePromptPairs(old,newer);
 assert.deepEqual([...r.old.values()].map(p=>[p.oldId,p.newId,p.status]).sort(),[['1','2','same'],['2','3','same'],['3','4','changed']]);
 assert.equal(r.new.get('1').status,'added');assert.equal(r.new.get('2'),r.old.get('1'));
 const reverse=comparePromptPairs(newer,old);for(const p of r.old.values())assert.equal(reverse.old.get(p.newId).newId,p.oldId);
});
test('an unchanged stable identity keeps the real body edit when another entry copies its former body',()=>{
 const a=preset(['A','Hero','Original']); const b=preset(['A','Hero','Changed'],['B','Copy','Original']);
 assert.equal(comparePromptPairs(a,b).old.get('A').newId,'A');
});
test('duplicate titles with exchanged slots follow distinctive text, not traversal order',()=>{
 const a=preset(['1','标题','甲'],['2','标题','乙']);const b=preset(['1','标题','乙'],['2','标题','甲']);
 const r=comparePromptPairs(a,b);assert.equal(r.old.get('1').newId,'2');assert.equal(r.old.get('2').newId,'1');
});
test('a same-title copy cannot steal the edited original on a stable identifier',()=>{
 const a=preset(['A','Title','Earlier body']),b=preset(['A','Title','Revised body'],['B','Title','Earlier body']);
 const r=comparePromptPairs(a,b);assert.equal(r.old.get('A').newId,'A');assert.equal(r.new.get('B').status,'added');
});
test('repetitive templates, unrelated numeric slots and markers do not receive guessed counterparts',()=>{
 const a=preset(['1','Old','old text'],['2','one','Repeated'],['4','two','Repeated'],['m','Mark','mark',true]);
 const b=preset(['1','New','new text'],['3','three','Repeated'],['5','four','Repeated'],['m','Mark','mark']);
 const r=comparePromptPairs(a,b);for(const p of r.old.values())assert.equal(p.newId,null);
 assert.equal(r.old.get('2').status,'uncertain');assert.equal(r.new.get('1').status,'uncertain');
});
test('fuzzy moves remain symmetric and a tied rival prevents a forced match',()=>{
 const body='The old lighthouse stands on an isolated point overlooking a narrow harbour. Its last keeper left a carefully folded letter.';
 const a=preset(['old','Lighthouse',body]),b=preset(['new','Light',body+' Afterward.']);
 assert.equal(comparePromptPairs(a,b).old.get('old').kind,'similar');
 b.prompts.push({...b.prompts[0],identifier:'rival'}); assert.equal(comparePromptPairs(a,b).old.get('old').status,'uncertain');
});
test('empty renamed heading needs a bounded label and a matching neighbour',()=>{
 const a=preset(['a','A','one'],['1','【章节】 范围一','']),b=preset(['a','A','one'],['2','【章节】','']);
 assert.equal(comparePromptPairs(a,b).old.get('1').newId,'2');
 b.prompts[1].name='【无关】';assert.equal(comparePromptPairs(a,b).old.get('1').newId,null);
});
test('ignore whitespace changes body equality without rewriting the input or confusing enabled changes',()=>{
 const a=preset(['a','T','a\r\nb']),b=preset(['a','T','a b']);b.prompt_order[0].order[0].enabled=false;
 const saved=JSON.stringify([a,b]);assert.equal(comparePromptPairs(a,b).old.get('a').status,'changed');
 assert.equal(comparePromptPairs(a,b,{ignoreWhitespace:true}).old.get('a').status,'same');assert.equal(JSON.stringify([a,b]),saved);
});
test('a stored correspondence survives an explicit edit only in the same comparison context',()=>{
 const a=preset(['s','Earlier','One exact body']),b=preset(['t','Later','One exact body']);
 const previous=comparePromptPairs(a,b);b.prompts[0].content='New';b.prompts[0].name='Totally new';
 const next=comparePromptPairs(a,b,{previous,edited:{old:new Set(),new:new Set(['t'])}});
 assert.equal(next.old.get('s').status,'changed');assert.equal(comparePromptPairs(a,b).old.get('s').newId,null);
});
test('existing migration places a custom entry between mapped anchors instead of reused IDs',()=>{
 const a=preset(['1','A','One'],['custom','X','Custom'],['2','B','Two']);
 const b=preset(['1','Other','Else'],['2','A','One'],['3','B','Two']);
 const plan=planMigration(a,b,['custom']);assert.deepEqual(plan.errors,[]);assert.deepEqual(plan.previewOrder.map(e=>e.id),['1','2','custom','3']);
});
test('a reused UUID with conflicting names and bodies is not sufficient identity',()=>{
 const id='27cac676-2b74-408e-8cbb-f68d8d4f4af3';
 const r=comparePromptPairs(preset([id,'One','alpha']),preset([id,'Two','omega']));
 assert.equal(r.old.get(id).status,'uncertain');
});
test('version with reordered and renumbered blocks, copies, edits and deletions preserves known correspondences',()=>{
 const oldRows=Array.from({length:72},(_,i)=>[String(i+1),'mode '+i,'instructions for mode '+i+' : '+String.fromCharCode(0x500+i).repeat(45)]);
 const rows=oldRows.filter((_,i)=>i%11!==0).reverse().map((r,i)=>[String(i+1),r[1],i%7?r[2]:r[2]+' with revisions']);
 rows.splice(4,0,['copy','Duplicate instructions',rows[2][2]]);
 const a=preset(...oldRows),b=preset(...rows),p=comparePromptPairs(a,b);
 for(const [i,r] of oldRows.entries()){const expected=rows.find(n=>n[1]===r[1]);assert.equal(p.old.get(r[0]).newId,expected?.[0]??null,'mode '+i);}
 assert.equal(p.new.get('copy').status,'added');
});
