// 检查上下文的纯功能回归：只读、草稿与启用顺序。
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectCheckContext } from '../src/features/preset/preset-check-context.js';
const make = () => ({prompts: ['a','b','c'].map(identifier=>({identifier,content:identifier,enabled:true})),prompt_order:[{character_id:100001,order:[{identifier:'b',enabled:true},{identifier:'a',enabled:false}]}]});
test('order switch wins, unlisted excluded, input unchanged',()=>{const p=make();p.prompts[1].enabled=false;const before=structuredClone(p);assert.deepEqual(collectCheckContext(p).entries.map(e=>e.id),['b']);assert.deepEqual(p,before);});
test('missing and empty order do not invent concatenation',()=>{for(const prompt_order of [undefined,[]]){const p={prompts:make().prompts,prompt_order};const before=structuredClone(p),c=collectCheckContext(p);assert.equal(c.streams.length,0);assert.ok(c.uncertainties.length);assert.deepEqual(p,before);}});
test('drafts control text, trigger and depth segment',()=>{const p=make();const drafts=new Map([['b',{content:'draft',trigger:'continue',role:'user',injection_position:'1',injection_depth:'2',injection_order:'7'}]]);assert.equal(collectCheckContext(p,{drafts}).entries.length,0);const c=collectCheckContext(p,{drafts,generationType:'continue'});assert.equal(c.entries[0].text,'draft');assert.deepEqual(c.streams[0].fragments.map(f=>[f.entryId,f.afterChat]),[['b',true]]);});
test('unchanged single-select trigger does not erase an imported multi-trigger set',()=>{
 const p=make();p.prompts[1].injection_trigger=['normal','continue'];
 const drafts=new Map([['b',{trigger:'normal',content:'draft'}]]);
 assert.deepEqual(collectCheckContext(p,{drafts,generationType:'continue'}).entries.map(e=>e.id),['b']);
 drafts.set('b',{trigger:'quiet'});
 assert.equal(collectCheckContext(p,{drafts,generationType:'continue'}).entries.length,0);
 assert.equal(collectCheckContext(p,{drafts,generationType:'quiet'}).entries.length,1);
});
test('group gate and marker boundaries',()=>{const p=make();p.extensions={baibaiToolkit:{presetPromptGroups:{groups:[{id:'g',enabled:false}],prompts:{b:{groupId:'g'}}}}};assert.equal(collectCheckContext(p).entries.length,0);delete p.extensions;p.prompts[1].marker=true;const c=collectCheckContext(p);assert.deepEqual(c.entries.map(e=>e.id),['b']);assert.equal(c.streams.length,0);});
// Additional boundaries and false-positive coverage.
test('depth entries join the single viewer-order stream deepest first',()=>{const p=make();p.prompt_order[0].order=p.prompts.map(x=>({identifier:x.identifier,enabled:true}));p.prompts.forEach((x,i)=>Object.assign(x,{injection_position:1,injection_depth:2,injection_order:i===2?8:7,role:i===1?'user':'system'}));p.prompts[0].injection_depth=5;const c=collectCheckContext(p);assert.equal(c.streams.length,1);assert.deepEqual(c.streams[0].fragments.map(f=>[f.type,f.entryId,f.afterChat]),[['source','a',true],['source','b',true],['source','c',true]]);});
test('invalid injection excluded and relative order preserved around markers',()=>{const p=make();p.prompt_order[0].order=p.prompts.map(x=>({identifier:x.identifier,enabled:true}));p.prompts[1].injection_position=-1;p.prompts[2].marker=true;const c=collectCheckContext(p);assert.deepEqual(c.entries.map(e=>e.id),['a','c']);assert.deepEqual(c.streams[0].fragments.map(f=>f.entryId),['a']);});
test('depth entries are placed at the chatHistory marker like the prompt viewer',()=>{const p={prompts:[{identifier:'head',content:'<x>'},{identifier:'chatHistory',marker:true},{identifier:'deep',content:'</x>',injection_position:1,injection_depth:2},{identifier:'tail',content:'<y>'}],prompt_order:[{character_id:100001,order:['head','chatHistory','deep','tail'].map(identifier=>({identifier,enabled:true}))}]};const c=collectCheckContext(p);assert.deepEqual(c.streams[0].fragments.map(f=>[f.entryId,f.afterChat]),[['head',false],['deep',true],['tail',true]]);});
