// 盒子接管后兼容柏宝箱待保存分组，验证定向同步与失败恢复。
import test from 'node:test';
import assert from 'node:assert/strict';
import { syncPresetGroupCaches } from '../src/host/native-groups.js';

function fixture() {
    const before = { groups: [{ id: 'g', name: '组', enabled: true, collapsed: false }], prompts: { a: { groupId: 'g' } } };
    const entry = { presetName: 'A', groupState: structuredClone(before), syncKey: 'old' };
    entry.groupState.groups.push({ id: 'other', name: '尚未保存的组' });
    entry.groupState.extra = 42;
    const vue = { pendingPresetPromptGroupSaves: new Map([['A', entry]]), pendingOpenAiPresetSaves: new Set(['A']), pendingPresetPromptServiceSaves: new Map([['A', { promptOrder: [1, 2] }]]) };
    const bai = { presetPromptGroupRuntimePresetName: 'A', presetPromptGroupRuntimeState: structuredClone(before), __baiBaiToolkitPresetVueListManager: vue };
    const after = structuredClone(before); after.groups[0].enabled = false; after.groups[0].collapsed = true;
    return { before, after, entry, vue, bai };
}

test('开关和折叠同步到已有队列，不清除待保存数据与其他组', () => {
    const { before, after, entry, vue, bai } = fixture();
    const restore = syncPresetGroupCaches(bai, 'A', before, after);
    assert.equal(entry.groupState.groups[0].enabled, false);
    assert.equal(entry.groupState.groups[0].collapsed, true);
    assert.equal(bai.presetPromptGroupRuntimeState.groups[0].enabled, false);
    assert.equal(entry.groupState.groups[1].name, '尚未保存的组');
    assert.equal(entry.groupState.extra, 42);
    assert.deepEqual([...vue.pendingOpenAiPresetSaves], ['A']);
    assert.deepEqual(vue.pendingPresetPromptServiceSaves.get('A').promptOrder, [1, 2]);
    assert.equal(entry.syncKey, 'A:' + JSON.stringify(entry.groupState));
    restore();
    assert.equal(entry.groupState.groups[0].enabled, true);
    assert.equal(entry.syncKey, 'old');
});

test('保存失败时不覆盖期间出现的原地编辑', () => {
    const { before, after, entry, bai } = fixture();
    const restore = syncPresetGroupCaches(bai, 'A', before, after);
    entry.groupState.groups[0].name = '稍后的改名';
    restore();
    assert.equal(entry.groupState.groups[0].name, '稍后的改名');
});

test('解散同步移除归属，保留其他组且不触碰另一预设缓存', () => {
    const { before, entry, bai } = fixture();
    bai.presetPromptGroupRuntimePresetName = 'B';
    syncPresetGroupCaches(bai, 'A', before, { groups: [], prompts: {} });
    assert.deepEqual(entry.groupState.groups, [{ id: 'other', name: '尚未保存的组' }]);
    assert.deepEqual(entry.groupState.prompts, {});
    assert.equal(bai.presetPromptGroupRuntimeState.groups[0].id, 'g');
});
