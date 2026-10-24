// 预设正则快照：显式范围、归属和定义校验；不复活历史字段或回写规则正文。
import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotScope,selectSnapshotScope,validateSnapshot} from '../src/features/snapshot/snapshot.js';
import * as resources from '../src/features/snapshot/snapshot-resources.js';
const owner={apiId:'openai',presetName:'A'};
const rules=()=>[{id:'r',scriptName:'规则',findRegex:'/a/g',replaceString:'b',placement:[2],disabled:false,custom:{preserve:true}}];
const base=()=>({id:'s',name:'快照',presetName:'A',orderCharacterId:1,entries:[],groups:[],worldNames:[],scope:{preset:true,worlds:false,regex:false,presetRegex:true}});
test('legacy_preset_regex_does_not_reactivate',()=>{
 const s=base();delete s.scope.presetRegex;s.resources={regex:{global:[],preset:[{id:'r',enabled:false}],character:[]}};
 assert.equal(snapshotScope(s).presetRegex,false);assert.equal(selectSnapshotScope(s).presetRegex,undefined);
});
test('preset_regex_requires_preset_scope',()=>{
 const s=base();s.scope.preset=false;s.scope.regex=true;s.presetRegex={broken:true};
 assert.equal(snapshotScope(s).presetRegex,false);assert.equal(selectSnapshotScope(s).presetRegex,undefined);assert.doesNotThrow(()=>validateSnapshot(selectSnapshotScope(s)));
});
test('global_and_preset_scopes_are_independent',()=>{
 for(const p of [false,true])for(const r of [false,true])for(const g of [false,true]){
  const s=base();s.scope={preset:p,presetRegex:r,regex:g,worlds:true};s.presetRegex={version:1,owner,switches:[]};
  const saved=selectSnapshotScope(s);assert.equal(saved.scope.presetRegex,p&&r);assert.equal(saved.scope.regex,g);assert.equal(!!saved.presetRegex,p&&r);
 }
});
test('same_id_changed_definition_is_not_matched',()=>{
 assert.equal(typeof resources.capturePresetRegex,'function');
 const original=rules(),saved=resources.capturePresetRegex(original,owner);saved.switches[0].enabled=false;
 const changed=rules();changed[0].findRegex='/different/g';
 assert.throws(()=>resources.restorePresetRegex(saved,changed,owner),/定义.*变化|定义.*变更/);assert.equal(changed[0].disabled,false);
 assert.equal(resources.capturePresetRegex([{...original[0],disabled:true}],owner).switches[0].definitionFingerprint,saved.switches[0].definitionFingerprint);
 assert.deepEqual(Object.keys(saved.switches[0]).sort(),['definitionFingerprint','enabled','id','name']);
});
test('only switches change; new rules, order, groups and unknown fields remain',()=>{
 assert.equal(typeof resources.capturePresetRegex,'function');
 const saved=resources.capturePresetRegex(rules(),owner);saved.switches[0].enabled=false;
 const current=[{id:'new',scriptName:'新增',disabled:true},...rules()],before=structuredClone(current);
 const result=resources.restorePresetRegex(saved,current,owner);before[1].disabled=true;
 assert.deepEqual(result.scripts,before);assert.equal(current[1].disabled,false);assert.deepEqual(result.missing,[]);
 assert.deepEqual(resources.restorePresetRegex(saved,[],owner).missing,['规则']);
});
test('owner/version/missing fingerprints are rejected only within active scope',()=>{
 const s=base();s.presetRegex={version:1,owner,switches:[{id:'r',name:'规则',enabled:true}]};
 assert.throws(()=>validateSnapshot(s),/指纹|重新/);
 s.scope.presetRegex=false;assert.doesNotThrow(()=>validateSnapshot(selectSnapshotScope(s)));
 assert.equal(typeof resources.capturePresetRegex,'function');const saved=resources.capturePresetRegex(rules(),owner);
 assert.throws(()=>resources.restorePresetRegex(saved,rules(),{...owner,presetName:'B'}),/归属/);
 assert.throws(()=>resources.normalizePresetRegex({...saved,version:2}),/版本/);
 assert.throws(()=>validateSnapshot({...base(),presetRegex:{...saved,owner:{...owner,presetName:'B'}}}),/归属/);
});
test('duplicate and absent IDs match definitions without array-position guessing',()=>{
 assert.equal(typeof resources.capturePresetRegex,'function');
 const a={id:'dup',scriptName:'a',findRegex:'a',disabled:false},b={id:'dup',scriptName:'b',findRegex:'b',disabled:false};
 const noId={findRegex:'c',disabled:false};const saved=resources.capturePresetRegex([a,b,noId],owner);
 saved.switches[0].enabled=false;saved.switches[2].enabled=false;
 const result=resources.restorePresetRegex(saved,[b,noId,a],owner);
 assert.deepEqual(result.scripts.map(x=>x.disabled),[false,true,true]);
 const identical=resources.capturePresetRegex([a,a],owner);
 assert.throws(()=>resources.restorePresetRegex(identical,[a],owner),/相同定义|身份.*歧义/);
});
test('identical repeated definitions never use occurrence position to assign switches',()=>{
 const a={id:'dup',scriptName:'same',findRegex:'a',replaceString:'b',disabled:false};
 const middle={id:'middle',scriptName:'middle',findRegex:'b',replaceString:'c',disabled:false};
 const last={...a,disabled:true},saved=resources.capturePresetRegex([a,middle,last],owner);
 const reordered=[last,middle,a],before=structuredClone(reordered);
 assert.throws(()=>resources.restorePresetRegex(saved,reordered,owner),/相同定义|身份.*歧义/);
 assert.deepEqual(reordered,before);
 const unique=resources.capturePresetRegex([a],owner);
 assert.throws(()=>resources.restorePresetRegex(unique,[a,middle,last],owner),/相同定义|身份.*歧义/);
});
