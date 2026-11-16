// 原生分组显示缓存：校验控件位置和行隐藏状态，避免原生行未换时漏掉被移除的标题。
export function captureNativeGroupLayout(list, rows) {
    return {
        root: list.classList.contains('pcm-native-groups'),
        nodes: [...list.querySelectorAll('[data-pcm-ng]')].map(node => ({
            node, parent: node.parentNode,
            anchor: node.dataset.pcmNg === 'header' ? node.nextElementSibling : undefined,
        })),
        rows: rows.map(node => ({ node, hidden: node.classList.contains('pcm-ng-hidden'), off: node.classList.contains('pcm-ng-off') })),
    };
}

export function nativeGroupLayoutIntact(list, layout) {
    return Boolean(layout && list.classList.contains('pcm-native-groups') === layout.root
        && list.querySelectorAll('[data-pcm-ng]').length === layout.nodes.length
        && layout.nodes.every(({ node, parent, anchor }) => node.parentNode === parent
            && (anchor === undefined || node.nextElementSibling === anchor))
        && layout.rows.every(({ node, hidden, off }) => node.parentNode === list
            && node.classList.contains('pcm-ng-hidden') === hidden && node.classList.contains('pcm-ng-off') === off));
}
