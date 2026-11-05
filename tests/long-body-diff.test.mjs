// 长正文差异：检查实际可见的两侧文字与高亮区间，不使用用户预设。
import test from 'node:test';
import assert from 'node:assert/strict';
import {diffLines,buildRows} from '../src/features/preset/core.js';
import {buildSearchRows} from '../src/features/preset/ui/search-highlight.js';

function projection(a,b) {
  const rows=buildRows(diffLines(a,b));
  return [a,b].map((text,i)=>{
    const visible=buildSearchRows(rows,i?'new':'old','');
    assert.equal(visible.map(row=>row.segs.map(s=>s.text).join('')).join('\n'),text);
    return visible.flatMap(row=>row.segs.filter(s=>s.t===(i?'+':'-')).map(s=>s.text));
  });
}
test('long wrapped body keeps the inner title aligned across blanks in both directions',()=>{
  const core=Array.from({length:570},(_,i)=>i%4?'Paragraph '+i:'').join('\n');
  const original='# [清泉]\n\n'+core+'\n\n',wrapped='<style>\n\n[清泉]\n\n'+core+'\n</style>';
  assert.deepEqual(projection(original,wrapped),[['# '],['<style>','</style>']]);
  assert.deepEqual(projection(wrapped,original),[['<style>','</style>'],['# ']]);
});
test('low edit distance still works with no unique line anchors',()=>{
  const body=Array(1600).fill('another copy').join('\n');
  assert.deepEqual(projection(body,'open\n'+body+'\nclose'),[[],['open','close']]);
});
test('large disjoint replacements leave a surviving interior island untouched',()=>{
  const run=(v,n)=>Array(n).fill(v).join('\n');
  const original=[run('原甲',330),'shared left',run('common lines',600),'shared right',run('原乙',380)].join('\n');
  const newer=[run('新甲',490),'shared left',run('common lines',600),'shared right',run('新乙',475)].join('\n');
  const [removed,added]=projection(original,newer);
  assert.equal(removed.length,710);assert.equal(added.length,965);
  assert.ok(removed.every(t=>t==='原甲'||t==='原乙')&&added.every(t=>t==='新甲'||t==='新乙'));
});
test('many aligned line edits retain inline detail after the alignment work limit',()=>{
  const lines=Array.from({length:95},(_,i)=>'Line '+i+' completed');
  const [removed,added]=projection(lines.map(s=>s+' before').join('\n'),lines.map(s=>s+' after').join('\n'));
  assert.deepEqual(removed,Array(95).fill('before'));assert.deepEqual(added,Array(95).fill('after'));
});
test('a long single line with small changes at both ends keeps all shared words',()=>{
  const s='a repeated phrase '.repeat(2500).trim();
  const [minus,plus]=projection('OLD '+s+' STOP','NEW '+s+' END');
  assert.deepEqual(minus,['OLD','STOP']);assert.deepEqual(plus,['NEW','END']);
});
test('mixed repeated lines, blank lines, whitespace and rearrangements always reconstruct exactly',()=>{
  let seed=7;const rnd=n=>((seed=(Math.imul(1664525,seed)+1013904223)>>>0)%n);
  const terms=['',' ','ab','aba','乙','\t',' <abc>','相同','🚲','A\r','x'];
  const doc=()=>Array.from({length:rnd(35)},()=>terms[rnd(terms.length)]).join('\n');
  for(let i=0;i<120;i++)projection(doc(),doc());
});
