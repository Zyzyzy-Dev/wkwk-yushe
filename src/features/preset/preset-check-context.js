// 预设源码检查上下文：只读收集草稿、有效启用条目和可确定的源码段。
import { findPromptOrderEntry } from './core.js';
import { blockedPrompts } from './native-groups.js';
export function collectCheckContext(preset, { drafts = new Map(), generationType = 'normal' } = {}) {
    const prompts = (preset?.prompts || []).map(p => {
        const d = drafts.get(p.identifier) || {}, v = { ...p, ...d };
        // The existing select shows only the first imported trigger. Merely opening
        // a form or editing its content must not narrow the imported trigger set.
        const originalTriggers = Array.isArray(p.injection_trigger) ? p.injection_trigger : [];
        const triggerChanged = Object.hasOwn(d, 'trigger') && d.trigger !== String(originalTriggers[0] || '');
        const triggers = triggerChanged ? (d.trigger ? [d.trigger] : []) : v.injection_trigger;
        return { id: p.identifier, name: String(v.name || p.identifier), text: String(v.content || ''), role: v.role || 'system', marker: Boolean(v.marker),
            injection_position: Number(v.injection_position || 0), injection_depth: Number(v.injection_depth ?? 4), injection_order: Number(v.injection_order ?? 100),
            enabled: v.enabled !== false, triggers: Array.isArray(triggers) ? [...triggers] : [] };
    });
    // core 的选择器会补齐缺失 prompt_order；传入隔离容器，不改原预设。
    const selected = findPromptOrderEntry({ prompts: preset?.prompts || [], prompt_order: preset?.prompt_order || [] });
    const order = selected?.order || [], byId = new Map(prompts.map(e => [e.id, e]));
    if (!order.some(o => byId.has(typeof o === 'string' ? o : o?.identifier))) return { entries: prompts, streams: [], uncertainties: ['没有有效启用顺序，仅检查逐条源码符号。'] };
    const blocked = blockedPrompts(preset?.extensions?.baibaiToolkit?.presetPromptGroups);
    const entries = [], seen = new Set();
    for (const row of order) {
        const id = typeof row === 'string' ? row : row?.identifier, e = byId.get(id);
        if (!e || seen.has(id)) continue;
        seen.add(id);
        const enabled = typeof row === 'object' && typeof row.enabled === 'boolean' ? row.enabled : e.enabled;
        if (!enabled || blocked.has(id) || (e.triggers.length && !e.triggers.includes(generationType)) || ![0, 1].includes(e.injection_position)) continue;
        entries.push(e);
    }
    // 与提示词查看器一致：相对条目按顺序拼接；宿主 marker 内容不在预设里，不打断配对；
    // 聊天深度条目按深度从深到浅插在聊天记录位置，聊天消息本身不计入。
    const source = (e, afterChat) => ({ type: 'source', entryId: e.id, start: 0, end: e.text.length, text: e.text, afterChat });
    const depth = entries.filter(e => !e.marker && e.injection_position === 1).sort((a, b) => b.injection_depth - a.injection_depth);
    const fragments = [];let chat = false;
    for (const e of entries) {
        if (e.marker) { if (e.id === 'chatHistory' && !chat) { chat = true; fragments.push(...depth.map(d => source(d, true))); } }
        else if (e.injection_position === 0) fragments.push(source(e, chat));
    }
    if (!chat) fragments.push(...depth.map(d => source(d, true)));
    const streams = fragments.length ? [{ id: 'context', kind: 'context', fragments }] : [], uncertainties = [];
    return { entries, streams, uncertainties: [...new Set(uncertainties)] };
}
