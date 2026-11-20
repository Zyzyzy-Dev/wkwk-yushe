// 本地编辑项目、轻量目录与界面偏好的 IndexedDB 存取和版本升级。
const DATABASE = 'preset-compare-projects';
const PROJECTS = 'projects';
const CATALOG = 'projectCatalog';
const PREFS = 'prefs';
let opening = null;

function catalogEntry({id, name, updatedAt}) {
  return {id, name, updatedAt};
}

function openDatabase() {
  if (opening) return opening;
  // 同时请求偏好和目录时共用一次打开。被旧标签阻塞期间也不排队重复升级。
  const request = indexedDB.open(DATABASE, 3);
  const pending = new Promise((resolve, reject) => {
    let blocked = false;
    function stopWaiting() {
      clearTimeout(waitTimer);
      blocked = true;
      reject(Error('本地项目库尚未就绪，请稍后重试。如有打开旧版预设编辑器的页面，可关闭后重试。'));
    }
    // 排在另一标签升级请求后面的 open 收不到自己的 blocked 事件。
    // 只限制尚未开始的等待，数据库开始迁移后允许游标完整处理所有旧项目。
    const waitTimer = setTimeout(stopWaiting, 2500);
    request.onblocked = stopWaiting;
    request.onupgradeneeded = () => {
      clearTimeout(waitTimer);
      const db = request.result;
      const hadProjects = db.objectStoreNames.contains(PROJECTS);
      if (!hadProjects) db.createObjectStore(PROJECTS, {keyPath:'id'});
      if (!db.objectStoreNames.contains(PREFS)) db.createObjectStore(PREFS, {keyPath:'id'});
      const catalog = db.createObjectStore(CATALOG, {keyPath:'id'});
      if (!hadProjects) return;
      // 只在升级事务里逐条读取旧正文；事务失败会一起撤销建仓与回填。
      const cursorRequest = request.transaction.objectStore(PROJECTS).openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        catalog.put(catalogEntry(cursor.value));
        cursor.continue();
      };
    };
    request.onsuccess = () => {
      clearTimeout(waitTimer);
      const db = request.result;
      if (blocked) {
        db.close();
        opening = null;
        return;
      }
      db.onversionchange = () => {
        db.close();
        if (opening === pending) opening = null;
      };
      db.onclose = () => { if (opening === pending) opening = null; };
      resolve(db);
    };
    request.onerror = () => {
      clearTimeout(waitTimer);
      opening = null;
      reject(request.error);
    };
  });
  opening = pending;
  return pending;
}

async function transact(stores, mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result, schedulingError;
    tx.oncomplete = () => resolve(result?.result);
    tx.onabort = () => reject(schedulingError || tx.error || Error('本地存储事务已中止'));
    try {
      result = operation(tx);
    } catch (error) {
      // 即使第一个 put 已成功入队，第二个同步报错也必须撤回整个事务。
      schedulingError = error;
      tx.abort();
    }
  });
}

export function writeProject(project) {
  return transact([PROJECTS, CATALOG], 'readwrite', tx => {
    tx.objectStore(PROJECTS).put(project);
    tx.objectStore(CATALOG).put(catalogEntry(project));
  });
}

export function removeProject(id) {
  return transact([PROJECTS, CATALOG], 'readwrite', tx => {
    tx.objectStore(PROJECTS).delete(id);
    tx.objectStore(CATALOG).delete(id);
  });
}

export function readProject(id) {
  return transact(PROJECTS, 'readonly', tx => tx.objectStore(PROJECTS).get(id));
}

export async function listProjects() {
  const rows = await transact(CATALOG, 'readonly', tx => tx.objectStore(CATALOG).getAll());
  return rows.sort((a,b) => b.updatedAt - a.updatedAt);
}

export function readUiPreferences() {
  return transact(PREFS, 'readonly', tx => tx.objectStore(PREFS).get('ui'));
}

export function writeUiPreferences(record) {
  return transact(PREFS, 'readwrite', tx => tx.objectStore(PREFS).put(record));
}
