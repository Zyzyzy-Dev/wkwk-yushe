// Scan balanced macro shells without evaluating macros or altering their source.
export function scanMacroSource(text) {
    if (typeof text !== 'string') throw new TypeError('Macro source must be a string');
    const nodes = [], issues = [], stack = [];
    const finish = (node, end, complete) => {
        node.end = end;
        node.complete = complete;
        node.raw = text.slice(node.start, end);
        const bodyEnd = complete ? end - 2 : end;
        const headEnd = node.delimiters[0] ?? bodyEnd;
        node.name = text.slice(node.start + 2, headEnd).trim().toLowerCase();
        node.separator = node.delimiters.length ? '::' : null;
        node.args = node.delimiters.map((offset, i) => {
            const start = offset + 2, end = node.delimiters[i + 1] ?? bodyEnd;
            return { start, end, raw: text.slice(start, end) };
        });
        delete node.delimiters;
    };
    for (let i = 0; i < text.length;) {
        const pair = text.slice(i, i + 2);
        if (pair === '{{') {
            const node = { start: i, children: [], delimiters: [] };
            (stack.length ? stack[stack.length - 1].children : nodes).push(node);
            stack.push(node);
            i += 2;
        } else if (pair === '}}') {
            if (stack.length) finish(stack.pop(), i + 2, true);
            else issues.push({ code: 'macro-unexpected-close', start: i, end: i + 2, message: '多余的宏结束括号' });
            i += 2;
        } else if (pair === '::' && stack.length) {
            stack[stack.length - 1].delimiters.push(i);
            i += 2;
        } else i++;
    }
    for (const node of stack) {
        finish(node, text.length, false);
        issues.push({ code: 'macro-unclosed', start: node.start, end: text.length, message: '宏未闭合' });
    }
    issues.sort((a, b) => a.start - b.start);
    return { nodes, issues };
}
