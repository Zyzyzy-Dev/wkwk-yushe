// 验证宿主导出边界：内容无损、宿主错误传播、取消与仅发起下载不能误报已保存。
import test from 'node:test';
import assert from 'node:assert/strict';
import {exportPresetFile} from '../src/host/preset-export.js';

const preset = {
  prompts: [{identifier: 'new', name: '恋爱企划', content: '{{setvar::恋爱企划::<其他选项>中文😀\r\n{{user}}</其他选项>}}'}],
  prompt_order: [{character_id: 100001, order: [{identifier: 'new', enabled: true}]}],
  extensions: {baibaiToolkit: {presetPromptGroups: {groups: [{id: 'g', name: '附加内容'}], prompts: {new: {groupId: 'g'}}}}},
  custom: {preserve: true},
};

test('exports the editor snapshot without dropping macros, order or extension fields', async () => {
  const before = JSON.stringify(preset);
  let calls = 0;
  const result = await exportPresetFile({name: '主预设:缝合/完成-已编辑.json', preset}, async (text, name, type, options) => {
    calls++;
    assert.deepEqual(JSON.parse(text), preset);
    assert.equal(name, '主预设_缝合_完成-已编辑.json');
    assert.equal(type, 'application/json;charset=utf-8');
    assert.deepEqual(options, {throwOnFailure: true});
    return {mode: 'browser', savedPath: ''};
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, {status: 'started'});
  assert.equal(JSON.stringify(preset), before);
});

test('legacy web downloads start without claiming the file was saved', async () => {
  assert.deepEqual(await exportPresetFile({name: 'p.json', preset}, () => {}), {status: 'started'});
});

test('distinguishes explicit native completion and cancellation', async () => {
  for (const result of [{savedPath: '/download/p.json'}, {mode: 'ios-native-share', completed: true}]) {
    assert.deepEqual(await exportPresetFile({name: 'p.json', preset}, async () => result), {status: 'saved'});
  }
  for (const result of [{mode: 'cancelled'}, {cancelled: true}, {mode: 'ios-native-share', completed: false}]) {
    assert.deepEqual(await exportPresetFile({name: 'p.json', preset}, async () => result), {status: 'cancelled'});
  }
});

test('propagates failures without attempting another download', async () => {
  let calls = 0;
  await assert.rejects(exportPresetFile({name: 'p.json', preset}, async () => {calls++; throw new Error('disk full');}), /disk full/);
  assert.equal(calls, 1);
  await assert.rejects(exportPresetFile({name: 'p.json', preset}, async () => ({mode: 'failed'})), /未能导出/);
});

test('invalid input or unavailable host downloader never starts a download', async () => {
  let calls = 0;
  const download = () => {calls++;};
  await assert.rejects(exportPresetFile({name: 'p.json', preset: {}}, download), /预设数据无效/);
  await assert.rejects(exportPresetFile({name: ' ', preset}, download), /文件名不能为空/);
  await assert.rejects(exportPresetFile({name: 'p.json', preset}, undefined), /不支持导出/);
  assert.equal(calls, 0);
});
