// 移动列表比例的边界回归：拖动不能挤掉任意一侧控件，矮屏也必须保留可用高度。
import test from 'node:test';
import assert from 'node:assert/strict';
import { paneHeights } from '../src/ui/pane-layout.js';

test('mobile split redistributes a fixed total while honoring the requested ratio', () => {
  assert.deepEqual(paneHeights(700, 0.3), { old: 210, new: 490, total: 700 });
  assert.deepEqual(paneHeights(700, 0.7), { old: 490, new: 210, total: 700 });
});
test('dragging past either end preserves room for both headers and list rows', () => {
  assert.deepEqual(paneHeights(700, -1), { old: 160, new: 540, total: 700 });
  assert.deepEqual(paneHeights(700, 2), { old: 540, new: 160, total: 700 });
});
test('short landscape viewport expands the scrollable total instead of crushing a pane', () => {
  assert.deepEqual(paneHeights(200, 0.8), { old: 160, new: 160, total: 320 });
});
test('invalid saved sizing falls back to two usable equal panes', () => {
  assert.deepEqual(paneHeights(NaN, NaN), { old: 160, new: 160, total: 320 });
  assert.deepEqual(paneHeights(700, Infinity), { old: 350, new: 350, total: 700 });
});
