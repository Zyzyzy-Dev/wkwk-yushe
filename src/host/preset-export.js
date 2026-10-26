// 预设更新编辑器 · 导出可分享的编辑快照，保留绑定脚本与分组，移除 API 连接资料。
// 浏览器只报告已发起下载；只有宿主明确回报保存完成才允许清除修改标记。
import { clone } from '../shared/clone.js';
import {withPresetHelperBinding} from './preset-helper-binding.js';

// SillyTavern settingsToUpdate 中 isConnection=true 的字段。宿主表还可补充未来字段；
// 保留这份列表，使旧宿主或从更新宿主导入的文件也不会泄出已知连接资料。
const CONNECTION_FIELDS = [
  'chat_completion_source', 'group_models', 'sort_models', 'openai_model', 'claude_model',
  'openrouter_model', 'openrouter_use_fallback', 'openrouter_providers', 'openrouter_quantizations',
  'openrouter_allow_fallbacks', 'openrouter_middleout', 'ai21_model', 'mistralai_model', 'cohere_model',
  'perplexity_model', 'groq_model', 'chutes_model', 'siliconflow_model', 'siliconflow_endpoint',
  'minimax_model', 'minimax_endpoint', 'electronhub_model', 'nanogpt_model', 'nanogpt_provider',
  'nanogpt_payg_override', 'deepseek_model', 'aimlapi_model', 'xai_model', 'pollinations_model',
  'moonshot_model', 'fireworks_model', 'cometapi_model', 'custom_model', 'custom_url',
  'custom_include_body', 'custom_exclude_body', 'custom_include_headers', 'custom_prompt_post_processing',
  'google_model', 'vertexai_model', 'zai_model', 'zai_endpoint', 'workers_ai_model', 'workers_ai_account_id',
  'reverse_proxy', 'show_external_models', 'proxy_password', 'vertexai_auth_mode', 'vertexai_region',
  'vertexai_express_project_id', 'bypass_status_check', 'azure_base_url', 'azure_deployment_name',
  'azure_api_version', 'azure_openai_model',
];

function removeConnectionFields(preset, settingsToUpdate) {
  const fields = new Set(CONNECTION_FIELDS);
  for (const [presetKey, setting] of Object.entries(settingsToUpdate || {})) {
    if (!Array.isArray(setting) || setting[3] !== true) continue;
    fields.add(presetKey);
    if (typeof setting[1] === 'string') fields.add(setting[1]);
  }
  for (const field of fields) delete preset[field];
}

function prepareHelperExport(helper) {
  // 酒馆助手的 OAI_PRESET_EXPORT_READY 契约：只按 export_with 清理脚本变量与按钮。
  // 不广播全局事件：其它扩展可能在监听器内写回当前预设或注入当前预设的分组。
  const visit = scripts => {
    if (!Array.isArray(scripts)) return;
    for (const script of scripts) {
      if (!script || typeof script !== 'object') continue;
      if (script.type === 'folder') {visit(script.scripts); continue;}
      if (script.export_with?.data === false) script.data = {};
      if (script.export_with?.button === false && script.button && typeof script.button === 'object') {
        script.button.buttons = [];
      }
    }
  };
  visit(helper?.scripts);
}

export async function exportPresetFile(payload, download, {settingsToUpdate, readSourcePreset} = {}) {
  if (!payload?.preset || !Array.isArray(payload.preset.prompts)) throw new Error('预设数据无效，未导出');
  if (typeof payload.name !== 'string' || !payload.name.trim()) throw new Error('导出文件名不能为空');
  if (typeof download !== 'function') throw new Error('当前酒馆不支持导出文件，请更新酒馆后重试');
  const name = payload.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim();
  if (!name) throw new Error('导出文件名无效');
  let preset = clone(payload.preset);
  if (typeof payload.tavernSource === 'string' && payload.tavernSource.length > 0) {
    if (typeof readSourcePreset !== 'function') throw new Error('无法读取来源预设的绑定脚本，请重新载入后导出');
    const source = await readSourcePreset(payload.tavernSource);
    if (!source || !Array.isArray(source.prompts)) throw new Error('来源预设已不存在，请重新载入或从文件导入后导出');
    // 编辑器不编辑助手绑定。只从明确来源补充最新助手数据，不取活动预设、不覆盖正文和分组。
    preset = withPresetHelperBinding(preset,source);
  }
  prepareHelperExport(preset.extensions?.tavern_helper);
  removeConnectionFields(preset, settingsToUpdate);
  const content = JSON.stringify(preset, null, 2);
  const result = await download(content, name, 'application/json;charset=utf-8', {throwOnFailure: true});
  if (result?.mode === 'failed') throw new Error('酒馆未能导出文件，请检查下载提示后重试');
  if (result?.cancelled === true || result?.mode === 'cancelled' || result?.completed === false) return {status: 'cancelled'};
  return {status: result?.savedPath || result?.completed === true ? 'saved' : 'started'};
}
