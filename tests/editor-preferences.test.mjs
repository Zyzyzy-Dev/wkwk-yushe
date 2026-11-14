// 预设偏好回归：补丁不覆盖其他开关，导入视图不泄漏同名分组状态或修改预设。
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEditorPreferences,initializeImportedGroups} from '../src/features/preset/editor-preferences.js';
test('defaults preserve existing behavior; only boolean settings are accepted',()=>{
  assert.deepEqual(normalizeEditorPreferences(),{collapseGroups:false,quickReply:false,floating:false,creatorMode:false,overwriteSameIdOnDrop:true});
  assert.deepEqual(normalizeEditorPreferences({collapseGroups:true,quickReply:true,floating:'true',creatorMode:true},{floating:true,quickReply:0,unrelated:true}),{collapseGroups:true,quickReply:true,floating:true,creatorMode:true,overwriteSameIdOnDrop:true});
});
test('same-id drag preference survives unrelated patches and rejects non-boolean values',()=>{
  const disabled=normalizeEditorPreferences({}, {overwriteSameIdOnDrop:false});
  assert.equal(disabled.overwriteSameIdOnDrop,false);
  assert.equal(normalizeEditorPreferences(disabled,{creatorMode:true}).overwriteSameIdOnDrop,false);
  assert.equal(normalizeEditorPreferences(disabled,{overwriteSameIdOnDrop:'true'}).overwriteSameIdOnDrop,false);
  assert.equal(normalizeEditorPreferences({overwriteSameIdOnDrop:0}).overwriteSameIdOnDrop,true);
});
test('reimport resets only that side and never writes imported group metadata',()=>{
  const preset={extensions:{baibaiToolkit:{presetPromptGroups:{groups:[{id:'one',collapsed:false,enabled:false},{id:'two',collapsed:true}]}}}};
  const before=structuredClone(preset),state={'g:old:stale':true,'g:old:one':false,'g:new:one':true};
  initializeImportedGroups(state,'old',preset,true);
  assert.deepEqual(state,{'g:new:one':true,'g:old:one':true,'g:old:two':true});
  initializeImportedGroups(state,'old',preset,false);assert.equal(state['g:old:one'],false);assert.equal(state['g:old:two'],false);
  assert.deepEqual(preset,before);
  initializeImportedGroups(state,'old',{},true);assert.deepEqual(state,{'g:new:one':true});
  initializeImportedGroups(state,'old',{extensions:{baibaiToolkit:{presetPromptGroups:{groups:{invalid:true}}}}},true);assert.deepEqual(state,{'g:new:one':true});
});
