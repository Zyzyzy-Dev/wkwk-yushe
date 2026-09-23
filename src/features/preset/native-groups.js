// 原生列表分组的纯数据操作与预设生成门控；兼容柏宝箱元数据，不隐式重排执行顺序。
import { clone } from '../../shared/clone.js';
import { createIdentifier } from './core.js';

export const UNGROUPED = '__ungrouped';
export function createPromptRangeGroup(value, orderedIds, startId, endId, name) {
    const start = orderedIds.indexOf(startId), end = orderedIds.indexOf(endId);
    if (start < 0 || end < 0 || new Set(orderedIds).size !== orderedIds.length) throw new Error('条目范围已变化，请重新选择');
    const state = changeGroups(value, 'preset', { type: 'create', name });
    const group = state.groups.at(-1);
    group.collapsed = true;
    const ids = orderedIds.slice(Math.min(start, end), Math.max(start, end) + 1);
    return { state: changeGroups(state, 'preset', { type: 'assign', groupId: group.id, ids }, orderedIds.map(id => ({ id }))), groupId: group.id, count: ids.length };
}
const setMember = (map, id, value) => Object.defineProperty(map, id, { value, enumerable: true, configurable: true, writable: true });
export function groupModel(value, kind) {
    if (value?.version != null && kind === 'regex' && Number(value.version) !== 1) throw new Error('正则分组版本不受支持，请更新插件');
    const state = clone(value || {});
    const seen = new Set();
    state.groups = (Array.isArray(state.groups) ? state.groups : []).filter(g => {
        if (!g?.id || g.id === UNGROUPED || seen.has(String(g.id))) return false;
        seen.add(String(g.id)); return true;
    }).map(g => ({ ...g, id: String(g.id) }));
    const key = kind === 'preset' ? 'prompts' : 'scripts';
    state[key] = state[key] && typeof state[key] === 'object' && !Array.isArray(state[key]) ? state[key] : {};
    if (kind === 'regex') { state.version = 1; state.ungrouped ??= { name: '未分组', collapsed: false }; }
    return state;
}
export function memberGroup(state, kind, id) {
    const groupId = state[kind === 'preset' ? 'prompts' : 'scripts']?.[id]?.groupId;
    return state.groups.some(g => g.id === groupId) ? groupId : UNGROUPED;
}
export function changeGroups(value, kind, action, entries = []) {
    const state = groupModel(value, kind), key = kind === 'preset' ? 'prompts' : 'scripts';
    const group = state.groups.find(g => g.id === action.groupId);
    if (action.type === 'create') {
        const name = String(action.name || '').trim();
        if (!name) throw new Error('分组名称不能为空');
        state.groups.push({ id: createIdentifier(), name, order: state.groups.length, collapsed: false, ...(kind === 'preset' ? { enabled: true } : {}) });
    } else if (action.type === 'assign') {
        if (action.groupId !== UNGROUPED && !group) throw new Error('目标分组已不存在');
        const valid = new Set(entries.map(e => String(e.id)));
        for (const id of action.ids || []) {
            if (!valid.has(id)) throw new Error('条目已变更，请重新打开列表');
            if (action.groupId === UNGROUPED && kind === 'preset') delete state[key][id];
            else setMember(state[key], id, { ...(Object.hasOwn(state[key], id) ? state[key][id] : {}), groupId: action.groupId });
        }
    } else {
        if (!group) throw new Error('分组已不存在');
        if (action.type === 'rename') {
            if (!String(action.name || '').trim()) throw new Error('分组名称不能为空');
            group.name = String(action.name).trim();
        } else if (action.type === 'delete') {
            state.groups = state.groups.filter(g => g !== group);
            for (const [id, meta] of Object.entries(state[key])) if (meta?.groupId === group.id) {
                if (kind === 'preset') delete state[key][id]; else setMember(state[key], id, { ...meta, groupId: UNGROUPED });
            }
        } else if (action.type === 'collapse') group.collapsed = !group.collapsed;
        else if (action.type === 'toggle' && kind === 'preset') group.enabled = group.enabled === false;
        else throw new Error('不支持的分组操作');
    }
    if (kind === 'regex') {
        const counters = new Map();
        for (const entry of entries) {
            const id = String(entry.id), groupId = memberGroup(state, kind, id), order = counters.get(groupId) || 0;
            setMember(state.scripts, id, { ...(Object.hasOwn(state.scripts, id) ? state.scripts[id] : {}), groupId, order }); counters.set(groupId, order + 1);
        }
    }
    return state;
}
export function blockedPrompts(state) {
    const off = new Set((state?.groups || []).filter(g => g.enabled === false).map(g => g.id));
    return new Set(Object.entries(state?.prompts || {}).filter(([, m]) => off.has(m?.groupId)).map(([id]) => id));
}

// 包装原生同步收集入口，finally 恢复成员自身状态；不改变宿主的异步渲染流程。
export function installGroupGate(manager, readState, owns) {
    if (!manager || typeof manager.getPromptCollection !== 'function' || typeof manager.isPromptDisabledForActiveCharacter !== 'function') return false;
    if (manager.getPromptCollection.pcmGroupGate) return true;
    const collect = manager.getPromptCollection, disabled = manager.isPromptDisabledForActiveCharacter;
    function gated(...args) {
        if (!owns()) return Reflect.apply(collect, this, args);
        const blocked = blockedPrompts(readState());
        if (!blocked.size) return Reflect.apply(collect, this, args);
        const restore = [];
        for (const entry of this.getPromptOrderForCharacter(this.activeCharacter) || []) if (blocked.has(entry.identifier)) {
            restore.push([entry, entry.enabled]); entry.enabled = false;
        }
        try {
            const collection = Reflect.apply(collect, this, args);
            if (typeof collection?.add === 'function') {
                const add = collection.add;
                collection.add = function (...prompts) {
                    const allowed = prompts.filter(p => !blocked.has(p?.identifier));
                    return allowed.length ? Reflect.apply(add, this, allowed) : undefined;
                };
            }
            return collection;
        } finally { for (const [entry, enabled] of restore) entry.enabled = enabled; }
    }
    gated.pcmGroupGate = true;
    manager.getPromptCollection = gated;
    manager.isPromptDisabledForActiveCharacter = function (id, ...args) {
        return Reflect.apply(disabled, this, [id, ...args]) || (owns() && blockedPrompts(readState()).has(id));
    };
    return true;
}
