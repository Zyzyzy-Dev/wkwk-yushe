// 原生分组的数据保真和实际生成门控回归；不依赖宿主 DOM。
import test from 'node:test';
import assert from 'node:assert/strict';
import { changeGroups, groupModel, installGroupGate, UNGROUPED, createPromptRangeGroup } from '../src/features/preset/native-groups.js';

test('首尾范围分组包含中间所有条目，支持反向和单条，且不修改来源', () => {
    const ids=['a','b','c','d'];
    const state={groups:[{id:'old',name:'旧组'}],prompts:{b:{groupId:'old',extra:42}}};
    const result=createPromptRangeGroup(state,ids,'d','b','新组');
    assert.equal(result.count,3);assert.equal(result.state.groups.at(-1).collapsed,true);
    for(const id of ['b','c','d'])assert.equal(result.state.prompts[id].groupId,result.groupId);
    assert.equal(result.state.prompts.b.extra,42);assert.equal(result.state.prompts.a,undefined);
    assert.equal(state.prompts.b.groupId,'old');
    assert.equal(createPromptRangeGroup(undefined,ids,'a','a','单条').count,1);
    assert.throws(()=>createPromptRangeGroup(state,ids,'missing','a','错误'),/范围/);
});

test('归组/解散只改归属，保留原顺序、未知字段与成员开关', () => {
    const state = { extra: 42, groups: [{ id: 'g', name: '测试', enabled: false, custom: 1 }], prompts: { a: { groupId: 'g', custom: 2 } } };
    const entries = [{ id: 'a', enabled: true }, { id: 'b', enabled: false }];
    const moved = changeGroups(state, 'preset', { type: 'assign', ids: ['b'], groupId: 'g' }, entries);
    assert.equal(moved.prompts.b.groupId, 'g'); assert.equal(moved.prompts.a.custom, 2);
    assert.equal(moved.groups[0].enabled, false); assert.equal(moved.extra, 42);
    const dissolved = changeGroups(moved, 'preset', { type: 'delete', groupId: 'g' }, entries);
    assert.deepEqual(dissolved.prompts, {}); assert.deepEqual(entries.map(e => e.enabled), [true, false]);
    assert.equal(state.prompts.b, undefined);
});
test('正则分组保留数据并按实际执行顺序记录组内顺序', () => {
    const state = { version: 1, groups: [{ id: 'g', name: '组' }], scripts: { a: { groupId: 'g', extra: 1 } } };
    const entries = [{ id: 'b' }, { id: 'x' }, { id: 'a' }];
    const result = changeGroups(state, 'regex', { type: 'assign', ids: ['b'], groupId: 'g' }, entries);
    assert.equal(result.scripts.b.order, 0); assert.equal(result.scripts.a.order, 1);
    assert.equal(result.scripts.a.extra, 1); assert.equal(result.scripts.x.groupId, UNGROUPED);
    assert.deepEqual(entries.map(e => e.id), ['b', 'x', 'a']);
    assert.throws(() => groupModel({ version: 2 }, 'regex'), /版本/);
    assert.throws(() => changeGroups(state, 'regex', { type: 'assign', ids: ['missing'], groupId: 'g' }, entries), /变更/);
});
function fixture() {
    const order = [{ identifier: 'a', enabled: true }, { identifier: 'b', enabled: false }, { identifier: 'c', enabled: true }];
    const manager = { activeCharacter: {}, getPromptOrderForCharacter: () => order,
        isPromptDisabledForActiveCharacter: id => !order.find(e => e.identifier === id)?.enabled,
        getPromptCollection() { const result = { collection: [], add(...p) { this.collection.push(...p); } }; for (const e of order) if (e.enabled) result.add({ identifier: e.identifier }); return result; } };
    return { order, manager };
}
test('组门控影响生成但不改变成员自身状态；后续注入也受组门控', () => {
    const { order, manager } = fixture(); const original = structuredClone(order);
    const state = { groups: [{ id: 'g', enabled: false }], prompts: { a: { groupId: 'g' }, b: { groupId: 'g' } } };
    let owns = true;
    assert.equal(installGroupGate(manager, () => state, () => owns), true);
    const result = manager.getPromptCollection(); result.add({ identifier: 'a' });
    assert.deepEqual(result.collection.map(p => p.identifier), ['c']); assert.deepEqual(order, original);
    assert.equal(manager.isPromptDisabledForActiveCharacter('a'), true);
    state.groups[0].enabled = true;
    assert.deepEqual(manager.getPromptCollection().collection.map(p => p.identifier), ['a', 'c']);
    state.groups[0].enabled = false; owns = false;
    assert.equal(manager.isPromptDisabledForActiveCharacter('a'), false);
    assert.deepEqual(manager.getPromptCollection().collection.map(p => p.identifier), ['a', 'c']);
});
test('原生收集抛错也必须恢复成员状态，重复安装不叠加', () => {
    const { order, manager } = fixture(); manager.getPromptCollection = () => { throw new Error('生成失败'); };
    const state = { groups: [{ id: 'g', enabled: false }], prompts: { a: { groupId: 'g' } } };
    installGroupGate(manager, () => state, () => true); const installed = manager.getPromptCollection;
    installGroupGate(manager, () => state, () => true); assert.equal(installed, manager.getPromptCollection);
    assert.throws(() => manager.getPromptCollection(), /生成失败/); assert.equal(order[0].enabled, true);
});
