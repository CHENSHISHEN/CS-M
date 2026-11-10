import moment from 'moment';
import _ from 'lodash/object';
//import crypto from 'crypto';

import {
  saveJsonPromise, saveProjectVersion, trackProjectVersion, readJsonPromise, saveJsonPromiseAs, openProjectFilePath,
removeAllVersionProject, openFileOrDirPath, ensureDirectoryExistence,
  renameVersion,
  dirSplicing, fileExists, deleteFile, basename, writeLog, getBackupAllFile,
  renameBackupAllFile, extractFile,
} from '../../lib/middle';
import { openLoading, closeLoading, optReset, STATUS } from '../common';
//import { pdman2sino, version2sino } from '../../lib/datasource_util';
import { removeHistory, addHistory, updateHistory } from '../config';
import allLangData from '../../lang';
import { projectSuffix } from '../../../profile';
import emptyProject from '../../lib/template/empty';
import { version } from '../../../package';
import {reduceProject, transformationData} from '../../lib/datasource_util';
import {setMemoryCache} from '../../lib/cache';
import * as template from '../../lib/template';
import {compareVersion} from '../../lib/update';
import {EDIT, READING} from '../../lib/variable';

/*
* 核心的action 负责整个项目的保存和删除
* */

/*
 * action 类型
 */

export const SAVE_PROJECT_SUCCESS = 'SAVE_PROJECT_SUCCESS'; // 保存成功
export const SAVE_PROJECT_FAIL = 'SAVE_PROJECT_FAIL'; // 保存失败

export const READ_PROJECT_SUCCESS = 'READ_PROJECT_SUCCESS'; // 读取成功
export const READ_PROJECT_FAIL = 'READ_PROJECT_FAIL'; // 读取失败

export const CREATE_PROJECT_SUCCESS = 'CREATE_PROJECT_SUCCESS'; // 创建成功
export const CREATE_PROJECT_ERROR = 'CREATE_PROJECT_ERROR'; // 创建失败

export const UPDATE_PROJECT = 'UPDATE_PROJECT'; // 更新项目
export const CLOSE_PROJECT = 'CLOSE_PROJECT'; // 关闭项目

export const UPDATE_PROJECT_INFO = 'UPDATE_PROJECT_INFO'; // 更新项目信息

/*
 * action 创建函数
 */

const saveProjectSuccess = (data) => {
  return {
    type: SAVE_PROJECT_SUCCESS,
    data,
  };
};

const saveProjectFail = (err) => {
  return {
    type: SAVE_PROJECT_FAIL,
    data: err,
  };
};

const readProjectSuccess = (data, path, isDemoProject, mode) => {
  return {
    type: READ_PROJECT_SUCCESS,
    data: {
      isDemoProject,
      info: path,
      data,
      mode,
    },
  };
};

const readProjectFail = (err) => {
  return {
    type: READ_PROJECT_FAIL,
    data: err,
  };
};

const createProjectSuccess = (data, path) => {
  return {
    type: CREATE_PROJECT_SUCCESS,
    data: {
      info: path,
      data,
    },
  };
};

const createProjectError = (error) => {
  return {
    type: CREATE_PROJECT_ERROR,
    data: error,
  };
};

export const updateProjectInfo = (info) => {
  return {
    type: UPDATE_PROJECT_INFO,
    data: info,
  };
};

// 文件保存、自动备份和改名共享同一项目队列，上一项失败不阻塞后续保存。
const projectOperations = new Map();
const queueProjectOperation = (info, operation) => {
  const key = info || '__newProject';
  const result = (projectOperations.get(key) || Promise.resolve()).catch(() => {}).then(operation);
  projectOperations.set(key, result);
  const clear = () => {
    if (projectOperations.get(key) === result) projectOperations.delete(key);
  };
  result.then(clear, clear);
  return result;
};
const withCallback = action => new Promise((resolve, reject) => {
  action(err => (err ? reject(err) : resolve()));
});

export const autoSaveProject = (data) => {
  const tempData = {
    ...data,
    updatedTime: moment().format('YYYY-M-D HH:mm:ss'),
    version,
  };
  return (dispatch, getState) => {
    const {info, mode} = getState()?.core || {};
    if (mode === READING || !info) return Promise.resolve(false);
    return queueProjectOperation(info, async () => {
      await saveProjectVersion(info, tempData, tempData.entities?.length > 1000);
      await withCallback(cb => getBackupAllFile({info, data: tempData}, cb));
      return true;
    }).catch(async (err) => {
      await writeLog(err).catch(() => {});
      return false;
    });
  };
};

export const saveProject = (data, title, saveAs, callback) => {
  const time = moment().format('YYYY-M-D HH:mm:ss');
  const tempData = {
    ...data,
    createdTime: saveAs ? time : data.createdTime || time,
    updatedTime: time,
    version,
  };
  return (dispatch, getState) => {
    const {info, mode} = getState()?.core || {};
    if (mode === READING) {
      callback && callback(new Error('Project is read only'));
      return Promise.resolve(false);
    }
    return queueProjectOperation(info, async () => {
      dispatch(openLoading(title));
      // 保存结果接缝：记录保存开始时的 redux 数据引用。异步落盘窗口内若出现
      // 新的项目更新（其他入口直接更新 redux），成功后不覆盖——保留新变更并保持
      // validateNeedSave 脏状态待下次保存；引用未变才发布 canonical 已存快照，
      // 使 redux 与 memoryCache('data') 引用一致（否则保存后恒判“未保存”）。
      const dataAtSaveStart = getState()?.core?.data;
      let error;
      try {
        if (saveAs) {
          const getName = p => basename(p, '.json').split('.')[0];
          const path = await saveJsonPromiseAs(tempData, (d, f) => {
            const oldData = JSON.parse(d.toString().replace(/^\uFEFF/, ''));
            oldData.name = getName(f);
            return JSON.stringify(oldData, null, 2);
          });
          const name = getName(path);
          await withCallback(cb => addHistory({
            describe: tempData.describe || '', name, avatar: tempData.avatar || '', path,
          }, cb)(dispatch, getState));
          tempData.name = name;
          trackProjectVersion(path, tempData);
          setMemoryCache('data', tempData);
          if (getState()?.core?.data === dataAtSaveStart) {
            dispatch(saveProjectSuccess(tempData));
          }
          dispatch(updateProjectInfo(path));
        } else {
          await saveProjectVersion(info, tempData, tempData.entities?.length > 1000);
          await withCallback(cb => getBackupAllFile({info, data: tempData}, cb));
          setMemoryCache('data', tempData);
          if (getState()?.core?.data === dataAtSaveStart) {
            dispatch(saveProjectSuccess(tempData));
          }
        }
      } catch (err) {
        error = err;
        dispatch(saveProjectFail(err));
      } finally {
        dispatch(closeLoading());
      }
      callback && callback(error);
      return !error;
    });
  };
};

export const close = () => {
  return {
    type: CLOSE_PROJECT,
  };
};

export const closeProject = (type) => {
  return (dispatch) => {
    dispatch(optReset(type));
    dispatch(close());
  };
};

export const readProject = (path, title, getState, type, isDemoProject, mode = EDIT) => {
  return (dispatch) => {
    dispatch(openLoading(title)); // 开启全局loading
    const config = getState()?.config?.data[0];
    // 判断项目文件是否为只读权限
    readJsonPromise(path, true)
      .then((data) => {
        if (data.version) trackProjectVersion(path, data);
        if (!data.version) {
          // 无效的项目
          const err = new Error(allLangData[config.lang].invalidProjectData);
          dispatch(readProjectFail(err));
          dispatch(closeLoading(STATUS[2], err));
        } else if (!isDemoProject && mode !== READING) {
          const newData = transformationData(data);
          // 将打开的项目记录存储到用户信息中
          addHistory({
            describe: newData.describe || '',
            name: newData.name || '',
            avatar: newData.avatar || '',
            path,
          }, (err) => {
            if (!err) {
              setMemoryCache('data', newData);
              dispatch(readProjectSuccess(newData, path, isDemoProject, mode));
              dispatch(closeLoading(STATUS[1], null, '', type));
            } else {
              dispatch(readProjectFail(err));
              dispatch(closeLoading(STATUS[2], err));
            }
          })(dispatch, getState);
        } else {
          const newData = transformationData(data);
          setMemoryCache('data', newData);
          dispatch(readProjectSuccess(newData, path, isDemoProject, mode));
          dispatch(closeLoading(STATUS[1], null, '', type));
        }
      })
      .catch((err) => {
        dispatch(readProjectFail(err));
        dispatch(closeLoading(STATUS[2], err));
      });
  };
};

export const openDemoProject = (h, t, title, type) => {
  return (dispatch, getState) => {
    dispatch(openLoading(title));
    let tempH = h;
    let isDemoProject = t || getState().core.isDemoProject;
    if (!tempH) {
      tempH = template[isDemoProject];
    }
    const data = transformationData(compareVersion('3.5.0', tempH.version.split('.'))
      ? reduceProject(tempH, 'defKey') : tempH);
    setMemoryCache('data', data);
    dispatch(readProjectSuccess(data, '', isDemoProject, EDIT));
    dispatch(closeLoading(STATUS[1], null, '', type));
  };
};

export const openProject = (title, type, path, suffix, isDemoProject, mode) => {
  // 从系统中选择项目 无需传递路径
  return (dispatch, getState) => {
    if (path) {
      readProject(path, title, getState, type, isDemoProject, mode)(dispatch);
    } else {
      const config = getState()?.config?.data[0];
      openProjectFilePath(allLangData[config.lang].invalidProjectFile, suffix).then((filePath) => {
        if (filePath) readProject(filePath, title, getState, type, isDemoProject, mode)(dispatch);
      }).catch((err) => {
        dispatch(readProjectFail(err));
      });
    }
  };
};

export const createProject = (data, path, title, type) => {
  return (dispatch, getState) => {
    dispatch(openLoading(title));
    // 如果传递的路径则直接保存 反之则需要选取路径
    new Promise((res, rej) => {
      if (!path) {
        openFileOrDirPath([], ['openDirectory']).then((dir) => {
          res(dir);
        }).catch(rej);
      } else {
        // 校验目录是否存在 如果不存在则需要创建
        ensureDirectoryExistence(path);
        res(path);
      }
    }).then((projectDir) => {
      if (!projectDir) {
        dispatch(closeLoading());
        return;
      }
      // 拼接路径和项目名
      const realFilePath = dirSplicing(projectDir, `${data.name}.${projectSuffix}.json`);
      const config = getState()?.config?.data[0];
      if (fileExists(realFilePath)) {
        throw new Error(allLangData[config.lang].createProjectExists);
      } else {
        const time = moment().format('YYYY-M-D HH:mm:ss');
        const newData = {
          ...emptyProject,
          ...data,
          version,
          createdTime: time,
          updatedTime: time,
        };
        saveJsonPromise(realFilePath, newData, false, true, true).then(() => {
          trackProjectVersion(realFilePath, newData);
          addHistory({
            describe: newData.describe || '',
            name: newData.name || '',
            avatar: newData.avatar || '',
            path: realFilePath,
          }, (err) => {
            if (!err) {
              dispatch(createProjectSuccess(newData, realFilePath));
              dispatch(closeLoading(STATUS[1], null, '', type));
            } else {
             // dispatch(createProjectError(err));
              dispatch(closeLoading(STATUS[2], err));
            }
          })(dispatch, getState);
        }).catch((err) => {
          dispatch(createProjectError(err));
          dispatch(closeLoading(STATUS[2], err));
        });
      }
    }).catch((err) => {
      dispatch(closeLoading(STATUS[2], err));
     // dispatch(createProjectError(err));
    });
  };
};

export const removeAllVersionProjectData = (title) => {
  return (dispatch, getState) => {
    const project = getState()?.core?.info;
    dispatch(openLoading(title));
    removeAllVersionProject(project);
    dispatch(removeAllVersionSuccess());
    dispatch(closeLoading(STATUS[1], null));
  };
};

export const updateProject = (data) => {
  return {
    type: UPDATE_PROJECT,
    data,
  };
};

export const renameProject = (newData, oldData, title, dataInfo) => {
  return (dispatch, getState) => {
    const oldFilePath = dirSplicing(dataInfo.path, '');
    const newFilePath = dirSplicing(newData.path, `${newData.name}.${projectSuffix}.json`);
    return queueProjectOperation(oldFilePath, async () => {
      dispatch(openLoading(title));
      const config = getState()?.config?.data[0];
      const moving = oldFilePath !== newFilePath;
      const rollbackDirectories = [];
      const oldHistory = {...oldData, path: oldFilePath};
      const newHistory = {
        describe: newData.describe || '',
        name: newData.name || '',
        avatar: newData.avatar || '',
        path: newFilePath,
      };
      let oldContents;
      let written = false;
      let historyAttempted = false;
      try {
        if (moving && fileExists(newFilePath)) {
          throw new Error(allLangData[config.lang].createProjectExists);
        }
        oldContents = await extractFile(oldFilePath);
        if (moving) {
          // 两个目录全部校验通过后才开始迁移，避免只完成一半。
          renameVersion(oldFilePath, newFilePath, oldData, newData, true);
          renameBackupAllFile(oldFilePath, newFilePath, oldData, newData, true);
          rollbackDirectories.push(renameVersion(oldFilePath, newFilePath, oldData, newData));
          rollbackDirectories.push(renameBackupAllFile(oldFilePath, newFilePath, oldData, newData));
        }
        await saveJsonPromise(newFilePath, _.omit({
          ...oldData, ...newData, updatedTime: moment().format('YYYY-M-D HH:mm:ss'),
        }, ['path']), false, moving, true);
        written = true;
        historyAttempted = true;
        await withCallback(cb => updateHistory(oldHistory, newHistory, cb)(dispatch, getState));
        // 项目与全部历史落盘成功后，最后才删除旧文件。
        if (moving) deleteFile(oldFilePath);
        dispatch(closeLoading(STATUS[1], null));
        return true;
      } catch (err) {
        const rollbackErrors = [];
        if (historyAttempted) {
          await withCallback(cb => updateHistory(newHistory, oldHistory, cb)(dispatch, getState))
            .catch(e => rollbackErrors.push(e.message));
        }
        if (written) {
          try {
            if (moving) deleteFile(newFilePath);
            else await saveJsonPromise(oldFilePath, oldContents.toString());
          } catch (e) { rollbackErrors.push(e.message); }
        }
        rollbackDirectories.reverse().forEach((rollback) => {
          try { rollback(); } catch (e) { rollbackErrors.push(e.message); }
        });
        if (rollbackErrors.length) err.message += `; rollback: ${rollbackErrors.join('; ')}`;
        dispatch(closeLoading(STATUS[2], err));
        return false;
      }
    });
  };
};

export const removeProject = (data, title) => {
  return (dispatch, getState) => {
    dispatch(openLoading(title));
    // 删除项目
    deleteFile(data.path);
    // 更新历史记录
    removeHistory(data)(dispatch, getState);
  };
};
