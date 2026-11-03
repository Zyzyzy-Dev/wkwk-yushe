// 查找替换模块 Worker：仅处理传入的条目副本与替换计划，不读取宿主、网络或编辑器状态。
import {applyReplacementPlan} from '../text-replace.js';
import {buildReplacementView, createEntryReplacementPreview} from './text-replace-view.js';

self.addEventListener('message', event => {
  const {type, payload = {}} = event.data || {};
  try {
    let result;
    if (type === 'view') result = buildReplacementView(payload.context, payload.options);
    else if (type === 'preview') result = createEntryReplacementPreview(payload.entries, payload.options);
    else if (type === 'apply') result = applyReplacementPlan(payload.entries, payload.plan, payload.keys);
    else throw new Error('未知的查找替换任务。');
    self.postMessage({ok: true, result});
  } catch (error) {
    self.postMessage({ok: false, error: {message: error?.message || String(error), code: error?.code}});
  }
});
