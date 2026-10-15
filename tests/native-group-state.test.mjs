// 执行宿主真实上下文和刷新闭包，覆盖列表尚未挂载时的生成门禁。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installGroupGate } from '../src/features/preset/native-groups.js';
import { clone } from '../src/shared/clone.js';

const host = fs.readFileSync(new URL('../src/host/native-groups.js', import.meta.url), 'utf8');
const contextStart = host.indexOf('    function presetContext() {');
const contextEnd = host.indexOf('    function regexContext(', contextStart);
const refreshStart = host.indexOf('    function refresh() {');
const refreshEnd = host.indexOf('    function schedule()', refreshStart);
assert.ok(contextStart >= 0 && contextEnd > contextStart && refreshStart >= 0 && refreshEnd > refreshStart);
const factory = new Function('openai', 'presetManager', 'fast', 'installGroupGate', 'clone', `
    const PRESET_PATH = 'baibaiToolkit.presetPromptGroups';
    const owns = () => true;
    let scheduled = 0;
    const observer = { disconnect() {}, observe() {} };
    const document = { body: {}, getElementById: () => null };
    const render = () => { throw new Error('测试不应渲染未连接的列表'); };
    ${host.slice(contextStart, contextEnd)}
    ${host.slice(refreshStart, refreshEnd)}
    return refresh;
`);

for (const [name, hasContext, fast, useFast] of [
    ['fast 和上下文均为 null', false, null, false],
    ['fast 为 null，上下文存在', true, null, false],
    ['fast 存在且 key 匹配', true, { key: 'preset:A:char', value: { groups: [{ id: 'g', enabled: false }], prompts: { b: { groupId: 'g' } } } }, true],
    ['fast 存在但 key 不匹配', true, { key: 'preset:B:char', value: { groups: [{ id: 'g', enabled: false }], prompts: { b: { groupId: 'g' } } } }, false],
]) test(`宿主状态读取与生成门禁：${name}`, () => {
    const state = { groups: [{ id: 'g', enabled: false }], prompts: { a: { groupId: 'g' } } };
    const order = [{ identifier: 'a', enabled: true }, { identifier: 'b', enabled: true }];
    const manager = {
        activeCharacter: { identifier: 'char' },
        ...(hasContext ? { listElement: { isConnected: false } } : {}),
        getPromptOrderForCharacter: () => order,
        getPromptById: id => ({ name: id }),
        isPromptDisabledForActiveCharacter: () => false,
        getPromptCollection() {
            const result = { collection: [], add(...prompts) { this.collection.push(...prompts); } };
            for (const entry of order) if (entry.enabled) result.add({ identifier: entry.identifier });
            return result;
        },
    };
    const openai = { promptManager: manager, oai_settings: { extensions: { baibaiToolkit: { presetPromptGroups: state } } } };
    let readState;
    const refresh = factory(openai, { getPresetManager: () => ({ getSelectedPresetName: () => 'A' }) }, fast,
        (pm, read, owns) => { readState = read; return installGroupGate(pm, read, owns); }, clone);
    refresh();
    assert.equal(manager.getPromptCollection.pcmGroupGate, true);
    const expected = useFast ? fast.value : state;
    assert.deepEqual(manager.getPromptCollection().collection.map(p => p.identifier), useFast ? ['a'] : ['b']);
    assert.equal(readState(), expected);
    assert.equal(manager.isPromptDisabledForActiveCharacter('a'), !useFast);
    assert.equal(manager.isPromptDisabledForActiveCharacter('b'), useFast);
    assert.deepEqual(order.map(entry => entry.enabled), [true, true]);
});
