// 正文搜索高亮：字面量匹配、diff 区间投影和安全文本节点渲染，不修改原文或编辑控件。
export function normalizeSearchQuery(query) {
  return String(query ?? '').trim().toLocaleLowerCase();
}

export function findSearchRanges(text, query) {
  text = String(text ?? '');
  const needle = normalizeSearchQuery(query);
  if (!needle) return [];
  const folded = text.toLocaleLowerCase(), ranges = [];
  // Lowercasing can expand a code point (e.g. İ). Keep offsets in the original text.
  let offsets;
  if (folded.length !== text.length) {
    offsets = [];
    let start = 0;
    for (const char of text) {
      for (let i = 0; i < char.toLocaleLowerCase().length; i++) offsets.push([start, start + char.length]);
      start += char.length;
    }
  }
  for (let from = 0, index; (index = folded.indexOf(needle, from)) !== -1;) {
    const end = index + needle.length;
    const range = offsets ? [offsets[index][0], offsets[end - 1][1]] : [index, end];
    const previous = ranges.at(-1);
    if (previous && range[0] < previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else ranges.push(range);
    from = end;
  }
  return ranges;
}

export function plainSearchRows(text) {
  return String(text ?? '').split('\n').map(text => ({t:' ', paired:false, segs:[{t:' ', text}]}));
}

// Match across diff segments and line breaks, then project onto this side's visible text.
export function buildSearchRows(rows, side, query) {
  const hidden = side === 'old' ? '+' : '-';
  const visible = rows.filter(row => row.t !== hidden).map(row => ({
    t:row.t, paired:row.paired,
    segs:row.segs.filter(seg => seg.t !== hidden),
  }));
  const text = visible.map(row => row.segs.map(seg => seg.text).join('')).join('\n');
  const ranges = findSearchRanges(text, query);
  let offset = 0, cursor = 0;
  return visible.map(row => {
    const segs = [];
    for (const seg of row.segs) {
      const end = offset + seg.text.length;
      let pos = offset;
      while (pos < end) {
        while (cursor < ranges.length && ranges[cursor][1] <= pos) cursor++;
        const range = ranges[cursor], hit = !!range && range[0] <= pos;
        const stop = Math.min(end, range ? (hit ? range[1] : range[0]) : end);
        segs.push({t:seg.t, text:seg.text.slice(pos - offset, stop - offset), hit});
        pos = stop;
      }
      offset = end;
    }
    offset++; // The newline separating visible rows is not a DOM diff segment.
    return {t:row.t, paired:row.paired, segs};
  });
}

// Also usable by a plain <pre> preview. Never interpret preset text as HTML.
export function appendSearchText(parent, text, query) {
  const doc = parent.ownerDocument;
  text = String(text ?? '');
  let offset = 0;
  for (const [start, end] of findSearchRanges(text, query)) {
    parent.append(doc.createTextNode(text.slice(offset, start)));
    const mark = doc.createElement('mark');
    mark.className = 'pcm-search-hit';
    mark.textContent = text.slice(start, end);
    parent.append(mark);
    offset = end;
  }
  parent.append(doc.createTextNode(text.slice(offset)));
}
