// 渲染顺序索引必须保留字符串旧格式、重复 ID 优先级与空顺序行为。
import test from 'node:test';
import assert from 'node:assert/strict';
import { indexPromptOrder, indexedPromptEnabled, indexedPromptInjected } from '../src/features/preset/ui/list-order-index.js';

test('indexed prompt flags agree with first-match order and prompt fallback', () => {
  const order = ['legacy', { identifier: 'off', enabled: false }, { identifier: 'off', enabled: true }, { identifier: 'on', enabled: true }];
  const index = indexPromptOrder(order);
  assert.equal(indexedPromptEnabled(index, { identifier: 'legacy', enabled: false }), false);
  assert.equal(indexedPromptEnabled(index, { identifier: 'off' }), false);
  assert.equal(indexedPromptEnabled(index, { identifier: 'on', enabled: false }), true);
  assert.equal(indexedPromptInjected(index, { identifier: 'absent' }), false);
  assert.equal(indexedPromptInjected(index, { identifier: 'legacy' }), true);
  assert.deepEqual(order, ['legacy', { identifier: 'off', enabled: false }, { identifier: 'off', enabled: true }, { identifier: 'on', enabled: true }]);
});

test('empty or absent order retains all-injected behavior; a new render sees order mutations', () => {
  for (const order of [undefined, []]) assert.equal(indexedPromptInjected(indexPromptOrder(order), { identifier: 'a' }), true);
  const order = [{ identifier: 'a', enabled: false }];
  assert.equal(indexedPromptEnabled(indexPromptOrder(order), { identifier: 'a' }), false);
  order[0] = { identifier: 'a', enabled: true };
  order.push({ identifier: 'b', enabled: false });
  const refreshed = indexPromptOrder(order);
  assert.equal(indexedPromptEnabled(refreshed, { identifier: 'a' }), true);
  assert.equal(indexedPromptInjected(refreshed, { identifier: 'b' }), true);
});
