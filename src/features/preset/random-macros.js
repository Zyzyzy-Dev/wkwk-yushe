// Plan lossless random macro edits against an exact version of source text.
import { scanMacroSource } from './macro-source.js';

function reject(code, message, target) {
    const error = new Error(message);
    error.code = code;
    if (target) error.target = target;
    throw error;
}

function flatten(nodes) {
    const result = [], pending = [...nodes].reverse();
    while (pending.length) {
        const node = pending.pop();
        result.push(node);
        for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i]);
    }
    return result;
}

export function scanRandomMacros(text) {
    const scan = scanMacroSource(text);
    const all = flatten(scan.nodes), issues = [...scan.issues];
    const incomplete = all.filter(node => !node.complete);
    // A complete child inside an unfinished outer shell is unsafe to offer as a block.
    const macros = all.filter(node => node.complete && node.name === 'random' && node.separator === '::'
        && !incomplete.some(parent => parent.start < node.start && parent.end >= node.end));
    for (const node of all) {
        if ((node.name === 'random' || /^random\s/.test(node.name)) && (!node.complete || node.separator !== '::')) {
            issues.push({ code: 'random-unsupported', start: node.start, end: node.end, message: 'random 宏未闭合或语法不受支持' });
        }
    }
    return { macros, issues };
}

// Reparse the full proposed source: separators and shells can interact at splice edges.
function verifyRandomEdit(edit, macroStart, macroEnd, expectedArgs) {
    const result = applySourceEdit(edit.before, edit);
    const macro = scanRandomMacros(result.text).macros.find(node => node.start === macroStart && node.end === macroEnd);
    if (!macro || macro.args.length !== expectedArgs.length || macro.args.some((arg, i) => arg.raw !== expectedArgs[i])) {
        reject('random-edit-unsafe-boundary', '拼接边界会改变宏或候选内容，无法无损快捷转换，请在完整源码中处理');
    }
    return edit;
}

export function planRandomAppend(text, target) {
    const start = typeof target === 'number' ? target : target?.start;
    const macro = scanRandomMacros(text).macros.find(node => node.start === start);
    if (!macro || (typeof target === 'object' && ((target.end != null && target.end !== macro.end) || (target.raw != null && target.raw !== macro.raw)))) {
        reject('random-target-invalid', '无法定位完整且受支持的 random 宏');
    }
    const position = macro.end - 2;
    return verifyRandomEdit(
        { before: text, start: position, end: position, replacement: ':: ', selectionStart: position + 2, selectionEnd: position + 3 },
        macro.start, macro.end + 3, [...macro.args.map(arg => arg.raw), ' '],
    );
}

export function planRandomWrap(text, selection) {
    const start = selection?.start ?? selection?.selectionStart;
    const end = selection?.end ?? selection?.selectionEnd;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length || end <= start) {
        reject('random-selection-invalid', '请选择非空正文');
    }
    const nodes = flatten(scanMacroSource(text).nodes);
    for (const node of nodes) {
        if (node.start >= end || node.end <= start) continue;
        if (node.name === 'random' || /^random\s/.test(node.name)) reject('existing-random', '请编辑现有 random 块', node);
        if (!node.complete || node.start < start || node.end > end) reject('random-selection-crosses-macro', '选区截断宏，无法无损转换');
    }
    const value = text.slice(start, end), scan = scanMacroSource(value);
    if (scan.issues.length) reject('random-selection-invalid-shell', '选区含残缺宏外壳');
    const roots = scan.nodes;
    for (let i = 0, index = 0; i < value.length;) {
        if (roots[index]?.start === i) { i = roots[index++].end; continue; }
        if (value.slice(i, i + 2) === '::') reject('random-selection-delimiter', '选区含顶层 ::，无法无损转换');
        i++;
    }
    const replacement = '{{random::' + value + ':: }}';
    const selectionStart = start + replacement.length - 3;
    return verifyRandomEdit(
        { before: text, start, end, replacement, selectionStart, selectionEnd: selectionStart + 1 },
        start, start + replacement.length, [value, ' '],
    );
}

export function applySourceEdit(currentText, edit) {
    if (!edit || currentText !== edit.before) reject('source-edit-stale', '正文已变化，请重新生成编辑计划');
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < 0 || edit.end < edit.start || edit.end > currentText.length || typeof edit.replacement !== 'string') {
        reject('source-edit-invalid', '编辑区间无效');
    }
    const text = currentText.slice(0, edit.start) + edit.replacement + currentText.slice(edit.end);
    if (!Number.isInteger(edit.selectionStart) || !Number.isInteger(edit.selectionEnd) || edit.selectionStart < 0 || edit.selectionEnd < edit.selectionStart || edit.selectionEnd > text.length) reject('source-edit-invalid', '编辑后选区无效');
    return { text, selectionStart: edit.selectionStart, selectionEnd: edit.selectionEnd };
}
