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

function helperScript(id, exportWith = {data: true, button: true}) {
  return {type: 'script', id, name: id, enabled: true, content: 'console.log("synthetic fixture")',
    data: {counter: 4}, button: {enabled: true, buttons: [{name: 'run', visible: true}]}, export_with: exportWith};
}
async function exported(payload, options) {
  let value;
  await exportPresetFile(payload, text => {value = JSON.parse(text);}, options);
  return value;
}

test('removes native API connection fields but keeps generation parameters and unknown extension data', async () => {
  const input = {...structuredClone(preset), chat_completion_source: 'custom', custom_model: 'model',
    custom_url: 'https://fixture.invalid', custom_include_headers: 'X-Fixture: synthetic', proxy_password: 'synthetic',
    openai_model: 'model', vertexai_region: 'region', azure_deployment_name: 'deployment',
    temperature: 0.7, openai_max_context: 50000, openai_max_tokens: 1000, stream_openai: true,
    future_connection_field: 'future', custom_extension_parameter: 'keep'};
  input.extensions.other = {custom_url: 'documentation text', connection: {keep: true}};
  const before = structuredClone(input);
  const output = await exported({name: 'p.json', preset: input}, {settingsToUpdate: {
    future_connection_field: ['#future', 'future_connection_field', false, true],
    temperature: ['#temp', 'temp_openai', false, false],
  }});
  for (const key of ['chat_completion_source', 'custom_model', 'custom_url', 'custom_include_headers',
    'proxy_password', 'openai_model', 'vertexai_region', 'azure_deployment_name', 'future_connection_field']) {
    assert.equal(Object.hasOwn(output, key), false, key + ' is not portable connection data');
  }
  assert.equal(output.temperature, 0.7);
  assert.equal(output.openai_max_context, 50000);
  assert.equal(output.openai_max_tokens, 1000);
  assert.equal(output.stream_openai, true);
  assert.equal(output.custom_extension_parameter, 'keep');
  assert.deepEqual(output.extensions, input.extensions);
  assert.deepEqual(input, before);
});

test('refreshes only helper binding from the exact named source while preserving edited prompts and groups', async () => {
  const input = structuredClone(preset), source = structuredClone(preset);
  input.extensions.tavern_helper = {scripts: [helperScript('old binding')]};
  source.prompts[0].content = 'stale host text';
  source.extensions.tavern_helper = {scripts: [{type: 'folder', name: 'folder', enabled: true,
    scripts: [helperScript('new binding')]}], variables: {fixture: 1}};
  source.extensions.baibaiToolkit = {presetPromptGroups: {groups: []}};
  const inputBefore = structuredClone(input), sourceBefore = structuredClone(source), reads = [];
  const output = await exported({name: 'edited.json', preset: input, tavernSource: 'Source A'}, {
    readSourcePreset: name => {reads.push(name); return name === 'Source A' ? source : null;},
  });
  assert.deepEqual(reads, ['Source A']);
  assert.deepEqual(output.extensions.tavern_helper, source.extensions.tavern_helper);
  assert.deepEqual(output.prompts, input.prompts);
  assert.deepEqual(output.extensions.baibaiToolkit, input.extensions.baibaiToolkit);
  assert.deepEqual(source, sourceBefore);
  assert.deepEqual(input, inputBefore);
});

test('file imports keep their embedded binding and never look up a same-name or active host preset', async () => {
  const input = structuredClone(preset);
  input.extensions.tavern_helper = {scripts: [helperScript('embedded')]};
  const output = await exported({name: 'Source A.json', preset: input}, {
    readSourcePreset: () => {throw new Error('must not read host for a file import');},
  });
  assert.deepEqual(output.extensions.tavern_helper, input.extensions.tavern_helper);
});

test('an explicitly removed helper binding on the source does not resurrect the old copied scripts', async () => {
  const input = structuredClone(preset);
  input.extensions.tavern_helper = {scripts: [helperScript('removed')]};
  const output = await exported({name: 'p.json', preset: input, tavernSource: 'Source A'}, {
    readSourcePreset: () => structuredClone(preset),
  });
  assert.equal(Object.hasOwn(output.extensions, 'tavern_helper'), false);
  assert.equal(input.extensions.tavern_helper.scripts[0].id, 'removed');
});

test('missing or unreadable named source stops before download rather than borrowing active scripts', async () => {
  for (const readSourcePreset of [() => null, () => {throw new Error('read failed');}]) {
    let downloads = 0;
    await assert.rejects(exportPresetFile({name: 'p.json', preset, tavernSource: 'deleted'},
      () => {downloads++;}, {readSourcePreset}), /来源预设|read failed/);
    assert.equal(downloads, 0);
  }
});

test('honors helper export_with for scripts and folders without executing or changing source scripts', async () => {
  const input = structuredClone(preset);
  input.extensions.tavern_helper = {scripts: [helperScript('direct', {data: false, button: true}),
    {type: 'folder', scripts: [helperScript('nested', {data: true, button: false})]},
    {...helperScript('legacy'), export_with: undefined}], variables: {preserved: true}};
  const before = structuredClone(input), output = await exported({name: 'p.json', preset: input});
  const scripts = output.extensions.tavern_helper.scripts;
  assert.deepEqual(scripts[0].data, {});
  assert.deepEqual(scripts[0].button.buttons, [{name: 'run', visible: true}]);
  assert.deepEqual(scripts[1].scripts[0].data, {counter: 4});
  assert.deepEqual(scripts[1].scripts[0].button.buttons, []);
  assert.deepEqual(scripts[2].data, {counter: 4});
  assert.deepEqual(output.extensions.tavern_helper.variables, {preserved: true});
  assert.equal(scripts[0].content, input.extensions.tavern_helper.scripts[0].content);
  assert.deepEqual(input, before);
});
