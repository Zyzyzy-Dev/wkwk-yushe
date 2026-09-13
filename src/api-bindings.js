// API 与快照的一对一绑定及活动连接核对；纯数据逻辑，不访问宿主。
export const API_BINDINGS_KEY = 'preset_compare_api_snapshot_links';
export function bindApiSnapshot(links, apiId, snapshotId) {
  const next = (Array.isArray(links) ? links : []).filter(link => link.apiId !== apiId && (!snapshotId || link.snapshotId !== snapshotId));
  if (apiId && snapshotId) next.push({apiId, snapshotId});
  return next;
}
export function isApiProfileActive(profile, current) {
  return profile.source === current.source && profile.connection.custom_url.replace(/\/$/, '') === current.connection.custom_url.replace(/\/$/, '')
    && (!profile.additional || Object.keys(profile.additional).every(key => profile.additional[key] === (current.additional?.[key] || '')))
    && profile.model === current.model && profile.secretId === current.secretId;
}
