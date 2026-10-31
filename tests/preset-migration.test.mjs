// 两份预设迁移的合成行为回归：不读取私人预设。
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMigration, planMigration, applyMigration } from '../src/features/preset/migration.js';
const p = (identifier, extra = {}) => ({ identifier, name: identifier, content: `body ${identifier}`, ...extra });
const preset = (ids, tail = []) => ({ prompts: [...ids, ...tail].map(x => typeof x === 'string' ? p(x) : x), prompt_order: [{character_id: 100001, order: ids.map(x => ({identifier: typeof x === 'string' ? x : x.identifier, enabled: true}))}] });
const ids = data => data.prompt_order[0].order.map(x => typeof x === 'string' ? x : x.identifier);
const groups = (data, gs, members) => { data.extensions = { unrelated: {keep: true}, baibaiToolkit: {presetPromptGroups: {custom: 7, groups: gs, prompts: members}}}; return data; };

test('multiple gaps preserve target order and insert before new author interval entries', () => {
 const source = preset(['A','x','B','C','y','D']), target = preset(['A','author','B','C','D']);
 const before = JSON.stringify([source,target]);
 const plan = planMigration(source,target,['y','x']);
 assert.deepEqual(plan.errors, []); assert.deepEqual(plan.selectedIds,['x','y']);
 assert.deepEqual(plan.previewOrder.map(x=>x.id),['A','x','author','B','C','y','D']);
 assert.deepEqual(ids(applyMigration(source,target,plan)),['A','x','author','B','C','y','D']);
 assert.equal(JSON.stringify([source,target]),before);
 assert.deepEqual(analyzeMigration(source,plan.result).candidates,[]);
});
test('copy preserves full prompt, effective order fields and unrelated target fields', () => {
 const source = preset(['A',p('x',{content:'a\r\nb', enabled:true, injection_position:1,injection_depth:5,injection_order:9,injection_trigger:['normal','continue'], custom:{v:2}}),'B']);
 source.prompt_order[0].order[1] = {identifier:'x', enabled:false, custom:{n:3}};
 const target=preset(['A','B']); target.temperature=0.73; target.prompt_order.push({character_id:12,order:[{identifier:'B',enabled:false}]});
 const result=planMigration(source,target,['x']).result;
 assert.deepEqual(result.prompts.find(x=>x.identifier==='x'),source.prompts[1]);
 assert.deepEqual(result.prompt_order[0].order[1],source.prompt_order[0].order[1]);
 assert.equal(result.temperature,.73); assert.deepEqual(result.prompt_order[1],target.prompt_order[1]);
 result.prompts.find(x=>x.identifier==='x').custom.v=99; assert.equal(source.prompts[1].custom.v,2);
});
test('global reversed sections reject, manual placement repairs or smaller selection succeeds', () => {
 const source=preset(['A','x','B','C','y','D']),target=preset(['C','D','A','B']);
 const plan=planMigration(source,target,['x','y']); assert.match(plan.errors.join(' '),/顺序|区段/); assert.equal(plan.result,undefined);
 assert.deepEqual(planMigration(source,target,['x']).errors,[]);
 const fixed=planMigration(source,target,['x','y'],{placements:{y:{afterId:'B'}}}); assert.deepEqual(fixed.errors,[]); assert.deepEqual(ids(fixed.result),['C','D','A','x','B','y']);
});
test('same target gap batches merge in source order', () => {
 const source=preset(['A','x','B','y','C']),target=preset(['A','B','C']);
 assert.deepEqual(ids(planMigration(source,target,['x','y'],{placements:{x:{afterId:'A'},y:{afterId:'A'}}}).result),['A','x','y','B','C']);
});
test('no references and reversed references require explicit placement', () => {
 const source=preset(['A','x','B']),target=preset(['B','A']);
 assert.ok(planMigration(source,target,['x']).errors.length);
 const solo=preset(['x']); assert.equal(analyzeMigration(solo,target).candidates[0].defaultSelected,false);
 assert.ok(planMigration(solo,target,['x']).errors.length);
 assert.deepEqual(ids(planMigration(solo,target,['x'],{placements:{x:{beforeId:null}}}).result),['B','A','x']);
});
test('single-sided references work with warnings',()=>{
 const source=preset(['x','A','y']),target=preset(['A']); const plan=planMigration(source,target,['x','y']);
 assert.deepEqual(plan.errors,[]);assert.deepEqual(ids(plan.result),['x','A','y']);assert.ok(plan.warnings.length);
});
test('un-injected source items are excluded and cannot be selected for migration',()=>{
 const source=preset(['A','x'],['y']),target=preset(['A'],['tail']);
 assert.deepEqual(analyzeMigration(source,target).candidates.map(c=>c.id),['x']);
 const invalid=planMigration(source,target,['y']);assert.ok(invalid.errors.length);assert.equal(invalid.result,undefined);
 const plan=planMigration(source,target,['x']);assert.deepEqual(plan.errors,[]);assert.deepEqual(ids(plan.result),['A','x']);
 assert.deepEqual(plan.previewOrder.map(x=>[x.id,x.injected]),[['A',true],['x',true],['tail',false]]);
 assert.equal(plan.result.prompts.some(p=>p.identifier==='y'),false);
});
test('disabled injected source items remain candidates and preserve their off state',()=>{
 const source=preset(['A','x']),target=preset(['A']);source.prompt_order[0].order[1].enabled=false;
 const analysis=analyzeMigration(source,target);assert.deepEqual(analysis.candidates.map(c=>[c.id,c.injected,c.defaultSelected]),[['x',true,true]]);
 const plan=planMigration(source,target,['x']);assert.deepEqual(plan.errors,[]);assert.equal(plan.result.prompt_order[0].order[1].enabled,false);
});
test('ID wins, markers excluded, blank content and same names default unchecked',()=>{
 const source=preset(['A',p('marker',{marker:true}),p('blank',{content:''}),p('risk',{name:'same'})]);const target=preset(['A',p('other',{name:'same',content:'unrelated'})]);
 const a=analyzeMigration(source,target);assert.deepEqual(a.errors,[]);assert.deepEqual(a.candidates.map(x=>x.id),['blank','risk']);
 assert.equal(a.candidates[0].defaultSelected,false);assert.equal(a.candidates[1].kind,'ambiguous');assert.equal(a.candidates[1].defaultSelected,false);
});
test('unique nonempty exact body gives safe renamed reference and candidate stays visible',()=>{
 const source=preset([p('s',{content:'reference'}),'x','B']),target=preset([p('t',{content:'reference'}),'B']);
 const a=analyzeMigration(source,target);assert.equal(a.candidates[0].kind,'same-content');assert.equal(a.candidates[0].defaultSelected,false);
 assert.deepEqual(ids(planMigration(source,target,['x']).result),['t','x','B']);
});
test('duplicate exact bodies are ambiguous and never anchors',()=>{
 const source=preset([p('s1',{content:'repeat'}),p('s2',{content:'repeat'}),'x']);const target=preset([p('t',{content:'repeat'})]);
 assert.equal(analyzeMigration(source,target).candidates[0].kind,'ambiguous');assert.ok(planMigration(source,target,['x']).errors.length);
});
test('whitespace normalization only changes evidence and preserves original content',()=>{
 const source=preset([p('s',{content:'abc \r\n def'}),'x']),target=preset([p('t',{content:'abcdef'})]);
 assert.ok(planMigration(source,target,['x']).errors.length);
 const plan=planMigration(source,target,['x'],{ignoreWhitespace:true}); assert.deepEqual(plan.errors,[]);
 assert.equal(analyzeMigration(source,target,{ignoreWhitespace:true}).candidates[0].kind,'same-content');
});
test('fuzzy and competing fuzzy evidence never hides candidates or anchors positions',()=>{
 const body='The quick brown fox jumps over a lazy dog. Distinct useful instructions about a scene and characters.';
 const source=preset([p('s',{name:'source',content:body}),'x']); const target=preset([p('t',{name:'renamed',content:body+' Changed.'})]);
 let a=analyzeMigration(source,target); assert.equal(a.candidates[0].kind,'similar');assert.equal(a.candidates[0].defaultSelected,false);assert.ok(planMigration(source,target,['x']).errors.length);
 target.prompts.push(p('r',{name:'rival',content:body+' Revised.'}));a=analyzeMigration(source,target);assert.equal(a.candidates[0].kind,'ambiguous');assert.equal(a.candidates[0].matches.length,2);
});
test('malformed references and duplicate IDs block without repairing inputs',()=>{
 for (const mutate of [d=>d.prompts.push(p('A')),d=>d.prompt_order[0].order.push({identifier:'A'}),d=>d.prompt_order[0].order.push({identifier:'missing'})]) {
  const source=preset(['A','x']);mutate(source);const before=JSON.stringify(source);assert.ok(analyzeMigration(source,preset(['A'])).errors.length);assert.ok(planMigration(source,preset(['A']),['x']).errors.length);assert.equal(JSON.stringify(source),before);
 }
});
test('missing prompt_order never mutated or silently injects tail',()=>{
 const source={prompts:[p('x')]},target={prompts:[p('A')]};const plan=planMigration(source,target,['x']);
 assert.deepEqual(analyzeMigration(source,target).candidates,[]);assert.ok(plan.errors.length);assert.equal(plan.result,undefined);
 assert.equal(Object.hasOwn(source,'prompt_order'),false);assert.equal(Object.hasOwn(target,'prompt_order'),false);
});
test('apply rejects changed inputs and invalid plans atomically',()=>{
 const source=preset(['A','x']),target=preset(['A']);const plan=planMigration(source,target,['x']);source.prompts[1].content='changed';assert.throws(()=>applyMigration(source,target,plan),/变化|变更|重新/);
 source.prompts[1].content='body x';target.temperature=1;assert.throws(()=>applyMigration(source,target,plan),/变化|变更|重新/);
 assert.throws(()=>applyMigration(source,target,{errors:['bad']}),/迁移|计划|bad/);
});
test('same-ID target group state is authoritative without explicit acceptance',()=>{
 const source=groups(preset(['A','x','B']),[{id:'g',name:'Source',enabled:false}],{x:{groupId:'g',custom:4}});
 const target=groups(preset(['A','B']),[{id:'g',name:'Target',enabled:true,custom:8}],{});
 const plan=planMigration(source,target,['x']);assert.deepEqual(plan.errors,[]);assert.equal(analyzeMigration(source,target).candidates[0].defaultSelected,true);
 const meta=plan.result.extensions.baibaiToolkit.presetPromptGroups;assert.deepEqual(meta.groups,target.extensions.baibaiToolkit.presetPromptGroups.groups);assert.deepEqual(meta.prompts.x,{groupId:'g',custom:4});assert.equal(plan.result.prompt_order[0].order[1].enabled,true);
});
test('closed and implicitly enabled target groups keep their exact metadata and member states',()=>{
 for(const targetGroup of [{id:'g',name:'Target',enabled:false,custom:8},{id:'g',name:'Target',custom:9}]){
  const source=groups(preset(['A','x','B']),[{id:'g',name:'Source',enabled:targetGroup.enabled===false}],{x:{groupId:'g'}});
  const target=groups(preset(['A','B']),[targetGroup],{A:{groupId:'g',extra:7},B:{groupId:'g'}});target.prompt_order[0].order[1].enabled=false;
  const before=JSON.stringify([source,target]);const plan=planMigration(source,target,['x']);assert.deepEqual(plan.errors,[]);
  assert.deepEqual(plan.result.extensions.baibaiToolkit.presetPromptGroups.groups,[targetGroup]);
  assert.deepEqual(plan.result.extensions.baibaiToolkit.presetPromptGroups.prompts.A,{groupId:'g',extra:7});
  assert.deepEqual(plan.result.prompt_order[0].order.filter(x=>x.identifier!=='x'),target.prompt_order[0].order);
  assert.equal(JSON.stringify([source,target]),before);
 }
});
test('new group copied with selected metadata only while target groups and metadata survive',()=>{
 const source=groups(preset(['A','x','y','B']),[{id:'g',name:'New',enabled:false,unknown:3}],{x:{groupId:'g',custom:2},y:{groupId:'g'}});
 const target=groups(preset(['A','B']),[{id:'old',name:'Old',enabled:true,order:77}],{A:{groupId:'old'},B:{}});
 // After A lies at the end of its existing group, hence a valid group boundary.
 const plan=planMigration(source,target,['x']);assert.deepEqual(plan.errors,[]);const meta=plan.result.extensions.baibaiToolkit.presetPromptGroups;
 assert.deepEqual(meta.groups[0],target.extensions.baibaiToolkit.presetPromptGroups.groups[0]);assert.equal(meta.groups[1].unknown,3);assert.equal(meta.prompts.y,undefined);assert.equal(meta.prompts.x.custom,2);assert.deepEqual(meta.prompts.A,{groupId:'old'});assert.deepEqual(plan.result.extensions.unrelated,{keep:true});
});
test('unique same-name target group is reused automatically even when its ID and state differ',()=>{
 const source=groups(preset(['A','x','B']),[{id:'g',name:'Same'}],{x:{groupId:'g'}});
 const target=groups(preset(['A','B']),[{id:'h',name:'Same',enabled:false,custom:8}],{A:{groupId:'h'},B:{groupId:'h'}});
 const plan=planMigration(source,target,['x']);assert.deepEqual(plan.errors,[]);
 assert.deepEqual(plan.result.extensions.baibaiToolkit.presetPromptGroups.groups,target.extensions.baibaiToolkit.presetPromptGroups.groups);
 assert.equal(plan.result.extensions.baibaiToolkit.presetPromptGroups.prompts.x.groupId,'h');assert.equal(plan.entries[0].groupId,'h');
 assert.equal(analyzeMigration(source,target).candidates[0].defaultSelected,true);
 const ungrouped=planMigration(source,target,['x'],{placements:{x:{groupId:'',beforeId:null}}});assert.deepEqual(ungrouped.errors,[]);
});
test('same-ID target group wins over another group with matching source name',()=>{
 const source=groups(preset(['A','x']),[{id:'g',name:'Same',enabled:false}],{x:{groupId:'g'}});
 const target=groups(preset(['A']),[{id:'g',name:'Renamed',enabled:true},{id:'h',name:'Same',enabled:false}],{A:{groupId:'g'}});
 const plan=planMigration(source,target,['x']);assert.deepEqual(plan.errors,[]);assert.equal(plan.entries[0].groupId,'g');
 assert.deepEqual(plan.result.extensions.baibaiToolkit.presetPromptGroups.groups,target.extensions.baibaiToolkit.presetPromptGroups.groups);
});
test('multiple same-name target groups block automatic grouping without choosing arbitrarily',()=>{
 const source=groups(preset(['A','x']),[{id:'g',name:'Same'}],{x:{groupId:'g'}});
 const target=groups(preset(['A']),[{id:'h1',name:'Same'},{id:'h2',name:'Same'}],{});
 const analysis=analyzeMigration(source,target);assert.equal(analysis.candidates[0].defaultSelected,false);
 const plan=planMigration(source,target,['x']);assert.match(plan.errors.join(' '),/分组/);assert.equal(plan.result,undefined);
});
test('automatic diagnostics do not point users to removed placement controls',()=>{
 for(const [source,target,chosen] of [
  [preset(['x']),preset(['A']),['x']],
  [preset(['A','x','B']),preset(['B','A']),['x']],
  [preset(['A','x','B','C','y','D']),preset(['C','D','A','B']),['x','y']],
  [groups(preset(['A','x','B','y','C']),[{id:'g',name:'New'}],{x:{groupId:'g'},y:{groupId:'g'}}),preset(['A','B','C']),['x','y']],
 ]){
  const plan=planMigration(source,target,chosen);assert.ok(plan.errors.length);assert.doesNotMatch(plan.errors.join(' '),/指定|调整位置|选择目标分组/);
  assert.doesNotMatch(analyzeMigration(source,target).candidates.map(c=>c.defaultReason).join(' '),/指定|调整位置|选择目标分组/);
 }
});
test('unknown selected IDs, stale placements and invalid groups reject',()=>{
 const source=preset(['A','x']),target=preset(['A']);
 for(const [chosen,placements] of [[['A'],{}],[['x'],{x:{beforeId:'missing'}}],[['x'],{x:{groupId:'missing'}}],[['x'],{x:{beforeId:'A',afterId:'A'}}]]) assert.ok(planMigration(source,target,chosen,{placements}).errors.length);
});
test('malformed structural containers report diagnostics instead of throwing or repairing',()=>{
 for(const source of [{prompts:[p('x')],prompt_order:{}},{prompts:[p('x')],extensions:{baibaiToolkit:{presetPromptGroups:{groups:{},prompts:{}}}}}]) {
  const before=JSON.stringify(source);assert.ok(analyzeMigration(source,preset(['A'])).errors.length);assert.ok(planMigration(source,preset(['A']),['x']).errors.length);assert.equal(JSON.stringify(source),before);
 }
});
test('repeated source names are a risk even if no target name matches',()=>{
 const source=preset(['A',p('x',{name:'Repeat'}),p('y',{name:'Repeat'})]);const a=analyzeMigration(source,preset(['A']));
 assert.deepEqual(a.candidates.map(c=>[c.kind,c.defaultSelected]),[['ambiguous',false],['ambiguous',false]]);
});
test('group boundaries include existing un-injected tail members',()=>{
 const source=groups(preset(['A','x']),[{id:'g',name:'New'}],{x:{groupId:'g'}});
 const target=groups(preset(['A'],['tail']),[{id:'old',name:'Old'}],{A:{groupId:'old'},tail:{groupId:'old'}});
 assert.match(planMigration(source,target,['x']).errors.join(' '),/拆分|分组/);
 assert.deepEqual(planMigration(source,target,['x'],{placements:{x:{groupId:'old'}}}).errors,[]);
});
test('a new group cannot silently span existing entries between incoming segments',()=>{
 const source=groups(preset(['A','x','B','y','C']),[{id:'g',name:'New'}],{x:{groupId:'g'},y:{groupId:'g'}});
 const target=preset(['A','B','C']);assert.match(planMigration(source,target,['x','y']).errors.join(' '),/跨越|分组/);
});
test('default selection only unchecks every inversion participant and keeps unrelated candidates',()=>{
 const source=preset(['A','x','B','C','y','D','E','z','F']),target=preset(['C','D','A','B','E','F']);
 const a=analyzeMigration(source,target);
 assert.deepEqual(a.candidates.map(c=>[c.id,c.defaultSelected]),[['x',false],['y',false],['z',true]]);
 assert.match(a.candidates[0].defaultReason,/顺序|区段/);assert.match(a.candidates[1].defaultReason,/顺序|区段/);
 assert.deepEqual(planMigration(source,target,a.candidates.filter(c=>c.defaultSelected).map(c=>c.id)).errors,[]);
});
test('all nonadjacent inversion participants are excluded from default selection',()=>{
 const source=preset(['A','x','B','C','y','D','E','z','F','G','safe','H']);
 const target=preset(['E','F','C','D','A','B','G','H']);const a=analyzeMigration(source,target);
 assert.deepEqual(a.candidates.map(c=>[c.id,c.defaultSelected]),[['x',false],['y',false],['z',false],['safe',true]]);
});

test('reusing a group away from its existing block requires explicit reassignment or placement',()=>{
 const source=groups(preset(['A','B','C','x']),[{id:'g',name:'Original'}],{x:{groupId:'g'}});
 const target=groups(preset(['A','B','C']),[{id:'g',name:'Original'},{id:'h',name:'Other'}],{A:{groupId:'g'},B:{groupId:'h'},C:{groupId:'h'}});
 assert.match(planMigration(source,target,['x']).errors.join(' '),/分组/);
 assert.deepEqual(planMigration(source,target,['x'],{placements:{x:{beforeId:'B'}}}).errors,[]);
 assert.deepEqual(planMigration(source,target,['x'],{placements:{x:{groupId:'h'}}}).errors,[]);
});
