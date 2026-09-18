// API 与快照的一对一绑定及活动连接核对；纯数据逻辑，不访问宿主。
export const API_BINDINGS_KEY = 'preset_compare_api_snapshot_links';
// 绑定列表来自扩展设置，可能混入 null 或非对象项；先筛掉再比较字段。
const isBinding = link => Boolean(link) && typeof link === 'object';

export function bindApiSnapshot(links, apiId, snapshotId) {
  const next = (Array.isArray(links) ? links : []).filter(link => isBinding(link) && link.apiId !== apiId && (!snapshotId || link.snapshotId !== snapshotId));
  if (apiId && snapshotId) next.push({apiId, snapshotId});
  return next;
}
export function isApiProfileActive(profile, current) {
  return profile.source === current.source && profile.connection.custom_url.replace(/\/$/, '') === current.connection.custom_url.replace(/\/$/, '')
    && (!profile.additional || Object.keys(profile.additional).every(key => profile.additional[key] === (current.additional?.[key] || '')))
    && profile.model === current.model && profile.secretId === current.secretId;
}
