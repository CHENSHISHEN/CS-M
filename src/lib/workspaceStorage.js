/**
 * 项目空间存储协议实现 (DEC-02 / WP-02)
 *
 * 目录结构规范：
 * workspace.json                    唯一当前提交指针，格式/空间ID/文档清单
 * .workspace.lock                   本地单写者租约
 * documents/<documentId>/<rev>.json 不可变文档修订版本
 * recovery/previous-manifest.json   上一次有效清单备份
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import moment from 'moment';

export const WORKSPACE_FORMAT = 'pdmaner-workspace';
export const WORKSPACE_VERSION = '1.0.0';
export const WORKSPACE_FILE = 'workspace.json';
export const LOCK_FILE = '.workspace.lock';
export const DOCUMENTS_DIR = 'documents';
export const RECOVERY_DIR = 'recovery';
export const PREVIOUS_MANIFEST_FILE = 'previous-manifest.json';

/**
 * 计算内容 SHA-256 校验哈希
 */
export const calculateHash = (content) => {
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  return crypto.createHash('sha256').update(str).digest('hex');
};

/**
 * 递归确保目录存在
 */
export const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

/**
 * 原子安全写文件（先写入临时文件，再原子替换）
 */
export const safeWriteJsonFile = (targetFile, data) => {
  const dir = path.dirname(targetFile);
  ensureDir(dir);
  const tmpFile = `${targetFile}.${Date.now()}.${Math.random().toString(36).substring(2, 8)}.tmp`;
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(tmpFile, content, 'utf8');
  fs.renameSync(tmpFile, targetFile);
};

/**
 * 判断目标路径是否为受管项目空间目录
 */
export const isWorkspaceDirectory = (targetPath) => {
  try {
    if (!targetPath || !fs.existsSync(targetPath)) return false;
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      return fs.existsSync(path.join(targetPath, WORKSPACE_FILE));
    }
    if (stat.isFile() && path.basename(targetPath) === WORKSPACE_FILE) {
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
};

/**
 * 获取工作空间根目录
 */
export const getWorkspaceRoot = (targetPath) => {
  if (!targetPath) return '';
  try {
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
      return targetPath;
    }
    if (path.basename(targetPath) === WORKSPACE_FILE) {
      return path.dirname(targetPath);
    }
    return path.dirname(targetPath);
  } catch (e) {
    return targetPath;
  }
};

/**
 * 单写者租约：检查是否被其他进程锁定
 */
export const isWorkspaceLocked = (workspaceDir) => {
  try {
    const lockPath = path.join(workspaceDir, LOCK_FILE);
    if (!fs.existsSync(lockPath)) return { locked: false };

    const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const pid = lockData.pid;

    if (!pid || pid === process.pid) {
      return { locked: false, self: true };
    }

    // 检查锁定进程是否仍然存活
    try {
      process.kill(pid, 0);
      // 进程仍然存活，确实被锁定
      return { locked: true, pid, lockData };
    } catch (err) {
      // ESRCH 说明进程已死亡，属于残留僵尸锁
      return { locked: false, stale: true, pid, lockData };
    }
  } catch (e) {
    return { locked: false, error: e.message };
  }
};

/**
 * 获取单写者租约锁
 */
export const acquireWorkspaceLock = (workspaceDir, workspaceId) => {
  try {
    const lockStatus = isWorkspaceLocked(workspaceDir);
    if (lockStatus.locked) {
      return {
        success: false,
        error: `项目空间已被进程 ${lockStatus.pid} 锁定，当前仅允许以只读模式访问。`,
        pid: lockStatus.pid,
      };
    }

    const lockPath = path.join(workspaceDir, LOCK_FILE);
    const lockPayload = {
      workspaceId: workspaceId || path.basename(workspaceDir),
      pid: process.pid,
      time: Date.now(),
      createdAt: new Date().toISOString(),
    };

    safeWriteJsonFile(lockPath, lockPayload);
    return { success: true, pid: process.pid };
  } catch (e) {
    return { success: false, error: e.message };
  }
};

/**
 * 释放单写者租约锁
 */
export const releaseWorkspaceLock = (workspaceDir) => {
  try {
    const lockPath = path.join(workspaceDir, LOCK_FILE);
    if (fs.existsSync(lockPath)) {
      const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      // 仅当锁文件为本进程持有或为僵尸锁时执行删除
      if (lockData.pid === process.pid || !lockData.pid) {
        fs.unlinkSync(lockPath);
      }
    }
    return true;
  } catch (e) {
    return false;
  }
};

/**
 * 读取项目空间清单
 */
export const readWorkspaceManifest = (workspaceDir) => {
  const root = getWorkspaceRoot(workspaceDir);
  const manifestPath = path.join(root, WORKSPACE_FILE);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`找不到工作空间清单文件: ${manifestPath}`);
  }
  const content = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(content);
  if (manifest.format !== WORKSPACE_FORMAT && manifest.format !== 'cs-m-workspace' && manifest.format !== 'pdmaner-workspace') {
    throw new Error(`非标准 CS-M 工作空间格式: ${manifest.format}`);
  }
  return manifest;
};

/**
 * 初始化全新项目空间目录结构与文档清单 (WP-02)
 */
export const initWorkspace = (workspaceDir, options = {}) => {
  const {
    name = '未命名项目',
    describe = '',
    initialModule = 'data-modeling',
    initialData = null,
  } = options;

  ensureDir(workspaceDir);
  ensureDir(path.join(workspaceDir, DOCUMENTS_DIR));
  ensureDir(path.join(workspaceDir, RECOVERY_DIR));

  const workspaceId = `ws-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  const now = moment().format('YYYY-MM-DD HH:mm:ss');

  const manifestDocuments = [];

  // 根据起始模块创建初始文档
  if (initialModule === 'drawing-platform') {
    const docId = `doc-draw-${Date.now().toString(36)}`;
    const drawingPayload = {
      id: docId,
      defKey: 'biz_arch',
      defName: '业务应用架构',
      describe: '通用架构图 · 只表达系统和组件关系',
      type: 'drawing',
      createdTime: now,
      updatedTime: now,
      canvasData: {
        cells: [],
      },
    };

    const docSubDir = path.join(workspaceDir, DOCUMENTS_DIR, docId);
    ensureDir(docSubDir);
    const docFilePath = path.join(docSubDir, '1.json');
    safeWriteJsonFile(docFilePath, drawingPayload);

    manifestDocuments.push({
      id: docId,
      kind: 'drawing',
      title: '业务应用架构',
      schemaVersion: '1.0.0',
      revision: 1,
      relativePath: `${DOCUMENTS_DIR}/${docId}/1.json`,
      contentHash: calculateHash(drawingPayload),
    });
  } else {
    // 默认为数据建模文档
    const docId = `doc-data-${Date.now().toString(36)}`;
    const dataPayload = initialData || {
      name,
      describe,
      version: '1.0.0',
      modules: [],
      entities: [],
      viewGroups: [],
      diagrams: [],
    };

    const docSubDir = path.join(workspaceDir, DOCUMENTS_DIR, docId);
    ensureDir(docSubDir);
    const docFilePath = path.join(docSubDir, '1.json');
    safeWriteJsonFile(docFilePath, dataPayload);

    manifestDocuments.push({
      id: docId,
      kind: 'data-model',
      title: name,
      schemaVersion: '1.0.0',
      revision: 1,
      relativePath: `${DOCUMENTS_DIR}/${docId}/1.json`,
      contentHash: calculateHash(dataPayload),
    });
  }

  const workspaceManifest = {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    workspaceId,
    name,
    describe,
    currentModule: initialModule,
    createdTime: now,
    updatedTime: now,
    manifest: {
      revision: 1,
      documents: manifestDocuments,
    },
  };

  const manifestPath = path.join(workspaceDir, WORKSPACE_FILE);
  safeWriteJsonFile(manifestPath, workspaceManifest);

  // 获得写租约
  acquireWorkspaceLock(workspaceDir, workspaceId);

  return workspaceManifest;
};

/**
 * 完整加载项目空间（读取清单及当前激活的所有修订文档）
 */
export const loadWorkspace = (workspaceDir) => {
  const root = getWorkspaceRoot(workspaceDir);
  const manifest = readWorkspaceManifest(root);
  const documents = {};

  const docEntries = manifest?.manifest?.documents || [];
  docEntries.forEach((docEntry) => {
    try {
      const docPath = path.join(root, docEntry.relativePath);
      if (fs.existsSync(docPath)) {
        const content = fs.readFileSync(docPath, 'utf8');
        const docData = JSON.parse(content);
        documents[docEntry.id] = {
          meta: docEntry,
          data: docData,
        };
      }
    } catch (err) {
      console.warn(`加载文档 ${docEntry.id} 失败:`, err);
    }
  });

  return {
    workspaceDir: root,
    manifest,
    documents,
    isLocked: isWorkspaceLocked(root).locked,
  };
};

/**
 * 提交文档修订并原子更新清单 (DEC-02)
 */
export const commitDocumentRevision = (workspaceDir, documentId, docPayload, options = {}) => {
  const root = getWorkspaceRoot(workspaceDir);

  // 检查写锁
  const lockStatus = isWorkspaceLocked(root);
  if (lockStatus.locked) {
    throw new Error(`无法提交：项目空间已被外部进程锁定。`);
  }

  const currentManifest = readWorkspaceManifest(root);
  const docList = currentManifest?.manifest?.documents || [];
  const targetDocIndex = docList.findIndex(d => d.id === documentId);

  let nextRevision = 1;
  let docEntry = null;

  if (targetDocIndex >= 0) {
    docEntry = docList[targetDocIndex];
    nextRevision = (docEntry.revision || 1) + 1;
  } else {
    // 新增文档
    docEntry = {
      id: documentId,
      kind: options.kind || 'drawing',
      title: options.title || docPayload.defName || docPayload.name || '新文档',
      schemaVersion: '1.0.0',
      revision: 1,
    };
  }

  // 1. 将新修订写入 documents/<docId>/<nextRevision>.json
  const docSubDir = path.join(root, DOCUMENTS_DIR, documentId);
  ensureDir(docSubDir);
  const relativePath = `${DOCUMENTS_DIR}/${documentId}/${nextRevision}.json`;
  const fullDocPath = path.join(root, relativePath);

  safeWriteJsonFile(fullDocPath, docPayload);
  const contentHash = calculateHash(docPayload);

  // 2. 将当前 workspace.json 备份至 recovery/previous-manifest.json
  const previousManifestPath = path.join(root, RECOVERY_DIR, PREVIOUS_MANIFEST_FILE);
  safeWriteJsonFile(previousManifestPath, currentManifest);

  // 3. 构造新清单并原子写入 workspace.json
  const updatedDocEntry = {
    ...docEntry,
    revision: nextRevision,
    relativePath,
    contentHash,
    updatedAt: new Date().toISOString(),
  };

  const updatedDocs = [...docList];
  if (targetDocIndex >= 0) {
    updatedDocs[targetDocIndex] = updatedDocEntry;
  } else {
    updatedDocs.push(updatedDocEntry);
  }

  const updatedManifest = {
    ...currentManifest,
    updatedTime: moment().format('YYYY-MM-DD HH:mm:ss'),
    manifest: {
      revision: (currentManifest?.manifest?.revision || 1) + 1,
      documents: updatedDocs,
    },
  };

  const manifestPath = path.join(root, WORKSPACE_FILE);
  safeWriteJsonFile(manifestPath, updatedManifest);

  return {
    success: true,
    revision: nextRevision,
    document: updatedDocEntry,
    manifest: updatedManifest,
  };
};
