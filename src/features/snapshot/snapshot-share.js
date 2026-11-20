// 快照分享文件只携带选定范围的资源引用与配置，导入时重建本地身份。
import {createIdentifier} from '../preset/core.js';
import {normalizeSnapshotName, snapshotScope, validateSnapshot} from './snapshot.js';
import {normalizeSnapshotReasoning} from './snapshot-reasoning.js';
import {normalizePresetRegex} from './snapshot-resources.js';

const FORMAT = 'wkwk-yushe.snapshot-share';
export const MAX_SNAPSHOT_SHARE_COUNT = 100;
export const MAX_SNAPSHOT_SHARE_BYTES = 8 * 1024 * 1024;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = value => typeof value === 'string';
const isSwitch = value => typeof value === 'boolean';
const isTextList = value => Array.isArray(value) && value.every(isText);
const nullable = check => value => value === null || check(value);

// 白名单只接受酒馆原生配置的对应类型。插件对象、自动化绑定、角色筛选与正文没有分享表示。
const worldFields = [
  [isSwitch, ['disable','constant','vectorized','selective','addMemo','ignoreBudget','useProbability',
    'excludeRecursion','preventRecursion','groupOverride','matchPersonaDescription','matchCharacterDescription',
    'matchCharacterPersonality','matchCharacterDepthPrompt','matchScenario','matchCreatorNotes']],
  [nullable(isSwitch), ['caseSensitive','matchWholeWords','useGroupScoring']],
  [Number.isFinite, ['position','depth','order','displayIndex','selectiveLogic','groupWeight']],
  [nullable(Number.isFinite), ['scanDepth','sticky','cooldown','delay']],
  [value => Number.isFinite(value) && value >= 0 && value <= 100, ['probability']],
  [value => isSwitch(value) || Number.isFinite(value), ['delayUntilRecursion']],
  [value => value === null || [0,1,2].includes(value), ['role']],
  [isTextList, ['key','keysecondary','triggers']],
  [isText, ['outletName','group']],
];

function portableWorldSettings(settings) {
  if (!isObject(settings)) throw new Error('快照世界书条目缺少有效配置');
  const result = {};
  for (const [check, fields] of worldFields) {
    for (const field of fields) {
      if (!Object.hasOwn(settings,field)) continue;
      const value = settings[field];
      if (!check(value)) throw new Error('快照世界书配置字段无效：'+field);
      result[field] = Array.isArray(value) ? [...value] : value;
    }
  }
  return result;
}

function list(value) {
  if (!Array.isArray(value)) throw new Error('快照分享文件缺少有效的列表');
  return value;
}

function label(value, fallback) {
  if (value === undefined) return fallback;
  if (!isText(value)) throw new Error('快照资源名称须为文本');
  return value;
}

function switches(items, key) {
  return list(items).map(item => {
    if (!isObject(item)) throw new Error('快照开关记录格式无效');
    return {[key]:item[key],name:label(item.name,item[key]),enabled:item.enabled};
  });
}

function portableResources(resources, scope) {
  if (!isObject(resources) || ![undefined,1,2].includes(resources.version)) throw new Error('快照资源版本不受支持');
  const global = scope.worlds ? [...list(resources.worlds?.global)] : [];
  const mounted = new Set(global);
  const books = scope.worlds ? list(resources.worldEntries).filter(book => mounted.has(book?.name)) : [];
  return {
    version:2, worlds:{global},
    worldEntries:books.map(book => ({
      name:book.name,
      entries:list(book.entries).map(entry => {
        if (!isObject(entry)) throw new Error('快照世界书条目格式无效');
        return {uid:entry.uid,name:label(entry.name,entry.uid),settings:portableWorldSettings(entry.settings)};
      }),
    })),
    regex:{global:scope.regex ? switches(resources.regex?.global,'id') : [], preset:[], character:[]},
  };
}

function portableRecord(snapshot) {
  const scope = snapshotScope(snapshot);
  const record = {
    name:normalizeSnapshotName(snapshot.name), scope,
    entries:scope.preset ? switches(snapshot.entries,'identifier') : [],
    groups:scope.preset ? switches(snapshot.groups,'id') : [],
    worldNames:scope.worlds ? [...list(snapshot.worldNames)] : [],
  };
  if (scope.preset) record.presetName = snapshot.presetName;
  if (scope.presetRegex) {
    const data = snapshot.presetRegex;
    if (!list(data?.switches).every(item => isText(item?.definitionFingerprint))) throw new Error('预设正则定义指纹无效');
    record.presetRegex = normalizePresetRegex(data,{apiId:'openai',presetName:record.presetName});
  }
  if (scope.reasoning) record.reasoning = normalizeSnapshotReasoning(snapshot.reasoning);
  if (snapshot.resources !== undefined && (scope.worlds || scope.regex)) record.resources = portableResources(snapshot.resources,scope);
  if (scope.regex && !record.resources) throw new Error('快照缺少全局正则配置');
  if (new Set(record.worldNames).size !== record.worldNames.length) throw new Error('快照世界书挂载名称重复');
  // 顺序节点是接收方本地的上下文；这里只提供普通节点及临时身份用于复用快照校验。
  validateSnapshot({...record,id:createIdentifier(),orderCharacterId:100001});
  return record;
}

function checkCount(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length < 1 || snapshots.length > MAX_SNAPSHOT_SHARE_COUNT) {
    throw new Error('每个快照分享文件须含 1–'+MAX_SNAPSHOT_SHARE_COUNT+' 份快照');
  }
  for (const item of snapshots) if (!isObject(item)) throw new Error('快照分享列表含无效记录');
}

function checkFileSize(bundle) {
  let json;
  try { json = JSON.stringify(bundle); } catch { throw new Error('快照分享文件必须是有效 JSON'); }
  if (json.length > MAX_SNAPSHOT_SHARE_BYTES || new TextEncoder().encode(json).byteLength > MAX_SNAPSHOT_SHARE_BYTES) {
    throw new Error('快照分享文件超过 8 MiB，请分批导出');
  }
}

// 对照已校验的白名单输出核对输入。对象字段允许调序，任何额外、缺少或被修正的字段均拒绝。
function sameRecord(value, expected) {
  if (value === expected) return true;
  if (!value || !expected || typeof value !== 'object' || typeof expected !== 'object') return false;
  if (Array.isArray(value) !== Array.isArray(expected)) return false;
  const keys = Object.keys(expected);
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key) && sameRecord(value[key],expected[key]));
}

export function buildSnapshotShare(snapshots) {
  checkCount(snapshots);
  const bundle = {format:FORMAT,version:1,snapshots:snapshots.map(portableRecord)};
  checkFileSize(bundle);
  return bundle;
}

export function readSnapshotShare(bundle) {
  if (!isObject(bundle) || bundle.format !== FORMAT) throw new Error('请选择酒馆盒子导出的快照分享文件');
  if (bundle.version !== 1) throw new Error('快照分享文件版本不受支持');
  if (Object.keys(bundle).length !== 3) throw new Error('快照分享文件含未知字段');
  checkCount(bundle.snapshots);
  checkFileSize(bundle);
  return bundle.snapshots.map((raw, index) => {
    try {
      const record = portableRecord(raw);
      if (!sameRecord(raw,record)) throw new Error('含未知字段或记录不完整');
      return record;
    } catch (error) { throw new Error('第 '+(index+1)+' 份快照无效：'+error.message); }
  });
}

function availableName(name, used) {
  if (!used.has(name)) return name;
  for (let number = 1; ; number++) {
    const suffix = number === 1 ? '（副本）' : '（副本 '+number+'）';
    // 名称校验按 UTF-16 长度计算；截断时避免拆开 emoji 的代理对。
    const root = name.slice(0,120-suffix.length).replace(/[\uD800-\uDBFF]$/,'').trimEnd();
    const candidate = root+suffix;
    if (!used.has(candidate)) return candidate;
  }
}

export function makeImportedSnapshots(bundle, existingSnapshots, orderCharacterId = 100001) {
  const records = readSnapshotShare(bundle);
  if (records.some(record => record.scope.preset) && !Number.isFinite(orderCharacterId) && !(isText(orderCharacterId) && orderCharacterId.trim())) {
    throw new Error('接收方预设的条目节点无效');
  }
  const usedNames = new Set(existingSnapshots.map(item => item.name?.trim()));
  const usedIds = new Set(existingSnapshots.map(item => item.id));
  const now = Date.now();
  return records.map(record => {
    let id;
    do { id = createIdentifier(); } while (usedIds.has(id));
    usedIds.add(id);
    const name = availableName(record.name,usedNames);
    usedNames.add(name);
    return validateSnapshot({...record,id,name,createdAt:now,updatedAt:now,orderCharacterId:record.scope.preset ? orderCharacterId : null});
  });
}
