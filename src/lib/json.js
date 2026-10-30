// 桌面版

import fs from 'fs';
import {createProjectFileGuard} from './project_file_guard';
import path from 'path';
import moment from 'moment';
import * as _ from 'lodash/object';
import { projectSuffix } from '../../profile';
import {defaultJVM, transform} from './datasource_util';
import { FormatMessage, Modal } from 'components';
import {postWorkerFuc} from './event_tool';
import {compareVersion} from './update';
import {brandExcelFile} from './workbook_branding';
const { execFile } = require('child_process');
const { randomBytes, createHash } = require('crypto');

const { ipcRenderer, shell } = require('electron');
const { app, dialog } = require('@electron/remote');

const user_config = 'user_config.json';
const project_config = 'project_config.json';
const base_path = 'userData';
const basePath = app.getPath(base_path);
// 此处分为两个目录 一个为用户的配置信息user_config 一个为通用的项目配置信息project_config
const userConfigPath = basePath + path.sep + user_config;
const projectConfigPath = basePath + path.sep + project_config;
// 执行jar包时输出的json文件路径
const execJarOut = basePath + path.sep;
// 删除整个目录 包括目下的所有文件
const deleteDirectoryFile = (dirPath) => {
  if (fs.existsSync(dirPath)) {
    fs.readdirSync(dirPath).forEach((file) => {
      const curPath = `${dirPath}${path.sep}${file}`;
      if (fs.lstatSync(curPath).isDirectory()) {
        deleteDirectoryFile(curPath);
      } else {
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(dirPath);
  }
};
// 判断目录是否存在 如果不存在则创建
export const ensureDirectoryExistence = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    const parentDir = path.dirname(dirPath);
    ensureDirectoryExistence(parentDir);
    fs.mkdirSync(dirPath);
  }
};
// 文件名和路径拼接
export const dirSplicing = (dir, fileName) => {
 return path.join(dir, fileName);
};
// 获取文件所在的目录
export const dirname = (file) => {
  return path.dirname(file);
};
// 判断文件是否已经存在
export const fileExists = (filePath) => {
  return fs.existsSync(filePath);
};
// 删除文件
export const deleteFile = (filePath) => {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};

export const saveNormalFile = async (file, dataBuffer, exclusive = false) => {
  let destination = file;
  if (!exclusive) {
    let current;
    try {
      current = fs.lstatSync(file);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    // 延续原写流跟随文件链接的语义，临时文件也必须位于真实目标目录。
    // 断链/循环链接的解析错误直接拒绝，不能用普通文件覆盖原链接。
    if (current?.isSymbolicLink()) destination = fs.realpathSync(file);
  }
  // 同目录写入并同步后再提交，写入失败时原文件始终可用。
  const tempFile = path.join(path.dirname(destination),
      `.${path.basename(destination)}.${process.pid}-${randomBytes(12).toString('hex')}.tmp`);
  let handle;
  try {
    const mode = fs.existsSync(destination) ? fs.statSync(destination).mode : undefined;
    handle = await fs.promises.open(tempFile, 'wx', mode);
    await handle.writeFile(dataBuffer);
    await handle.sync();
    await handle.close();
    handle = null;
    if (exclusive) {
      // 新建/改名不能覆盖校验后被其他操作创建的目标。
      await fs.promises.link(tempFile, destination);
    } else {
      await fs.promises.rename(tempFile, destination);
    }
    return dataBuffer;
  } finally {
    if (handle) {
      await handle.close().catch(() => {});
    }
    await fs.promises.unlink(tempFile).catch((err) => {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    });
  }
};

export const readNormalFile = (filePath) => {
  // 通用的文件读取方法
  return new Promise((res, rej) => {
    fs.readFile(filePath, (err, data) => {
      if (err) {
        rej(err);
      } else {
        res(data);
      }
    });
  })
};

const parseJson = (data, closeSpace = false) => {
  return new Promise((resolve, reject) => {
    if(typeof data === 'string') {
      resolve(data);
    } else {
      postWorkerFuc('json2string', true, [data, closeSpace]).then((d) => {
        resolve(d);
      }).catch((err) => {
        reject(err);
      })
    }
  });
}

// 同一路径的保存串行化：防止并发写同一项目文件交错损坏
const jsonSaves = new Map();
export const saveJsonPromise = (filePath, data, closeSpace = false, exclusive = false) => {
  const tempFilePath = filePath.endsWith('.json') ? filePath : `${filePath}.json`;
  const key = path.resolve(tempFilePath);
  const saving = (jsonSaves.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
    const tempData = await parseJson(data, closeSpace);
    if (!tempData) {
      throw new Error('Invalid serialized project');
    }
    return saveNormalFile(tempFilePath, tempData, exclusive);
  });
  jsonSaves.set(key, saving);
  const clear = () => {
    if (jsonSaves.get(key) === saving) jsonSaves.delete(key);
  };
  saving.then(clear, clear);
  return saving;
};

const projectFileGuard = createProjectFileGuard({fs, path, hash: value => createHash('sha256').update(value).digest('hex'),
  save: saveJsonPromise, message: key => FormatMessage.string({id: `projectFiles.${key}`})});
export const trackProjectVersion = projectFileGuard.track;
export const saveProjectVersion = async (file, data, closeSpace) => {
  await projectFileGuard.commit(file, data, closeSpace);
};

export const readJsonPromise = (filePath) => {
  return new Promise((res, rej) => {
    const tempFilePath = filePath.endsWith('.json') ? filePath : `${filePath}.json`;
    readNormalFile(tempFilePath).then((data) => {
      postWorkerFuc('string2json', true, [data.toString()]).then((d) => {
        res(d);
      }).catch((err) => {
        rej(err);
      })
    }).catch((err) => {
      rej(err);
    });
  });
};

export const saveJsonPromiseAs = (data, refactor) => {
  const tempData = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const extensions = [`${projectSuffix}.json`];
  return new Promise((res, rej) => {
    saveFile(tempData, [{ name: projectSuffix, extensions: extensions}], (path) => {
      if (!path.endsWith('.json')) {
        return `${path}.${projectSuffix}.json`;
      }else if (!path.endsWith(`.${projectSuffix}.json`)) {
        return path.replace(/\.json$/g, `.${projectSuffix}.json`);
      }
      return path;
    }, {
      defaultPath: typeof data === 'string' ? '' : data.name,
    }, refactor).then(({filePath}) => res(filePath)).catch(err => rej(err));
  });
};

export const getUserConfig = () => {
  return new Promise((res, rej) => {
    // 获取用户的配置信息
    const defaultUserConfigData = {
      projectHistories: [], // 历史项目记录
      lang: 'zh', // 当前应用使用的语言
    };
    const defaultProjectConfigData = {
      commonFields: [], // 通用字段信息 多个项目可通用
    };
    /*
    * %APPDATA% Windows 中
    * $XDG_CONFIG_HOME or ~/.config Linux 中
    * ~/Library/Application Support macOS 中
    * */
    const getData = (path, defaultData) => {
      return new Promise((r, j) => {
        readJsonPromise(path).then((data) => {
          r({
            ...defaultData,
            ...data,
          });
        }).catch(() => {
          // 如果用户信息报错 则需要使用默认数据进行覆盖
          saveJsonPromise(path, defaultData).then(() => {
            r(defaultData);
          }).catch((err) => {
            rej(err);
          })
        });
      })
    };
    Promise.all([getData(userConfigPath, defaultUserConfigData),
      getData(projectConfigPath, defaultProjectConfigData)]).then(result => {
        setTimeout(() => {
          res(result);
        }, 1000);
    }).catch((err) => {
      rej(err);
    });
  });
};

export const saveUserConfig = (data = []) => {
  return new Promise((res, rej) => {
    Promise.all([saveJsonPromise(userConfigPath, data[0] || {}, true),
      saveJsonPromise(projectConfigPath, data[1] || {}, true)]).then((result) => {
      setTimeout(() => {
        res(result);
      }, 100);
    }).catch((err) => {
      rej(err);
    });
  });
};

export const saveFile = (data, filters, fileValidate, options, refactor) => {
  // 将调用系统的目录弹出框
  return new Promise((res, rej) => {
    dialog.showSaveDialog({
      filters: filters || [],
      ...options,
    }).then(({filePath}) => {
      if (filePath) {
        let tempFile = filePath;
        if (fileValidate) {
          // 需要重组文件名
          tempFile = fileValidate(filePath);
        }
        saveNormalFile(tempFile, refactor ? refactor(data, tempFile) : data).then((data) => {
          res({
            data,
            filePath: tempFile,
          });
        }).catch((err) => {
          rej(err);
        })
      } else {
        rej(new Error());
      }
    }).catch((err) => {
      rej(err);
    })
  });
};

export const openFile = (filters) => {
  return new Promise((res, rej) => {
    dialog.showOpenDialog({
      filters: filters || []
    }).then(({filePaths}) => {
      if (filePaths.length > 0) {
        readNormalFile(filePaths[0]).then((data) => {
          res(data);
        }).catch((err) => {
          rej(err);
        });
      } else {
        res();
      }
    }).catch((err) => {
      rej(err);
    })
  });
};

export const getJavaHome = () => {
  return process.env.JAVA_HOME || process.env.JRE_HOME || process.env.JER_HOME || '';
};

export const openFileOrDirPath = (filters, properties, rest) => {
  return new Promise((res, rej) => {
    dialog.showOpenDialog({
      ...rest,
      filters: filters || [],
      properties: properties || ['openFile'], // 默认是打开文件
    }).then(({filePaths}) => {
      if (filePaths.length > 0) {
        res(filePaths[0])
      } else {
        res();
      }
    }).catch((err) => {
      rej(err);
    })
  });
};

export const openProjectFilePath = (errorFileMessage, suffix) => {
  const tempSuffix = suffix || projectSuffix;
  const extensions = suffix ? [suffix] : [`${projectSuffix}.json`, 'chnr.json'];
  return new Promise((res, rej) => {
    openFileOrDirPath([{ name: tempSuffix, extensions: extensions}]).then((file) => {
      if (!file) {
        res();
      } else if (extensions.every(e => !file.endsWith(`.${e}`))) {
        // 项目名不符合规范 抛出异常
        rej(new Error(errorFileMessage || 'Invalid project file'));
      } else {
        res(file);
      }
    }).catch((err) => {
      rej(err);
    })
  });
};

const getProject = (project, type) => {
  const tempArray = project.split(path.sep);
  if (type === 'name') {
    return tempArray[tempArray.length - 1].split('.pdman.json')[0];
  }
  return tempArray.splice(0, tempArray.length - 1).join(path.sep);
};


export const getAllVersionFile = (p, data, strictError = false) => {
  // 获取当前项目的所有版本数据
  // strictError（可选，默认 false）：readdir 失败时 reject 而不是 resolve([])，
  // 供资源总览区分“零版本”与“读取失败”；既有两参调用行为完全不变
  const versionDir = path.join(path.dirname(p), `.version_${data.name}`);
  if (!fs.existsSync(versionDir)) {
    return Promise.resolve([]);
  }
  return new Promise((res, rej) => {
    fs.readdir(versionDir, async (err, files) => {
      if (!err) {
        // 读取所有的文件信息 此处需要过滤其他无效的文件(目前先过滤非json文件，以.开头的文件)
        const allFiles = files.filter(f => f.endsWith('.json') && !f.startsWith('.'));
        res(allFiles.map(f => f.replace(/.json$/, '')).sort((a, b) => {
          if(compareVersion(a, b.split('.'))) {
            return -1;
          }
          return 1;
        }))
      } else if (strictError) {
        rej(err);
      } else {
        res([]);
      }
    })
  });
}

export const getAllVersionProject = (p, data, names) => {
  // 获取当前项目的所有版本数据
  const versionDir = path.join(path.dirname(p), `.version_${data.name}`);
  if (!fs.existsSync(versionDir)) {
    return Promise.resolve([]);
  }
  return Promise.all(names.map(f => {
    return new Promise((resolve, reject) => {
      readJsonPromise(path.join(versionDir, `${f}.json`)).then((version) => {
        resolve(_.omit(version, ['data']));
      }).catch((err) => {
        reject(err);
      })
    })
  }));
};

export const getOneVersion = (p, data, version) => {
  const versionDir = path.join(path.dirname(p), `.version_${data.name}`);
  return readJsonPromise(path.join(versionDir, `${version.name}.json`));
}

export const removeAllVersionProject = (project) => {
  // 获取当前项目的所有版本数据
  const proName = getProject(project, 'name');
  const proPath = getProject(project, 'path');
  const proVersionPath = `${proPath}${path.sep}.${proName}.version${path.sep}`;
  deleteDirectoryFile(proVersionPath);
};

export const getPathStep = () => {
  return path.sep;
};

export const execFileCmd = (cmd, params, cb) => {
  execFile(cmd, params,
    {
      maxBuffer: 100 * 1024 * 1024 * 1024, // 1G
    },
    (error, stdout, stderr) => {
      cb && cb(error, stdout, stderr);
    });
};

export const connectDB = (dataSource, config, params = {}, cmd, cb) => {
  // 创建临时文件
  const tempParams = {...params};
  const executionId = `${Date.now()}-${randomBytes(12).toString('hex')}`;
  const outFile = `${execJarOut}${executionId}.json`;
  const sinerFile = `${execJarOut}${executionId}-siner.json`;
  if ('sinerFile' in tempParams) {
    // 需要创建临时项目文件 转换字段
    const updateFields = (data) => {
      return (data || []).map(e => {
        const fields = (e.fields || []);
        return {
          ...e,
          indexes: (e.indexes || []).map(i => ({
            ...i,
            fields: (i.fields || []).map((f) => {
              return {
                ...f,
                fieldDefKey:
                    fields.find(field => field.id === f.fieldDefKey)?.defKey || f.fieldDefKey
              };
            }),
          })),
          fields: fields.map(f => {
            return {
              ...f,
              ...transform(f, dataSource, undefined, undefined, undefined, ['refDict']),
            };
          })
        }
      })
    };
    fs.writeFileSync(sinerFile, JSON.stringify({
      ...dataSource,
      entities: updateFields(dataSource.entities),
      views: updateFields(dataSource.views),
    }));
    tempParams.dataFile = sinerFile;
    tempParams.sinerFile = sinerFile;
  }
  console.log(outFile);
  const getParam = (params) => {
    const paramArray = [];
    Object.keys(params).forEach((p) => {
      if (p !== 'customer_driver') {
        const param = params[p] || '';
        const value = param.includes(' ') ? `"${param}"` : param;
        paramArray.push(`${p}='${value}'`);
      } if (p === 'driver') {
        paramArray.push(`driver_class_name='${params[p]}'`);
      }
    });
    return paramArray.concat(`out='${outFile}'`);
  };
  const javaHome = config?.javaHome || _.get(dataSource, 'profile.javaHome', '') || getJavaHome();
  const jvm = ('jvm' in (config || {})) ? config.jvm : defaultJVM;
  const jar = ipcRenderer.sendSync('jarPath');
  const tempValue = javaHome ? `${javaHome}${path.sep}bin${path.sep}java` : 'java';
  const customerDriver = _.get(tempParams, 'customer_driver', '');
  const commend = [
    '-Dfile.encoding=utf-8',
    ...jvm.split(' '),
    '-jar', jar, cmd,
    ...getParam(tempParams),
  ];
  if (customerDriver) {
    commend.unshift(`-Xbootclasspath/a:${customerDriver}`);
  }
  return execFile(tempValue, commend,
    {
      maxBuffer: 100 * 1024 * 1024 * 1024, // 1G
    },
    (error, stdout, stderr) => {
      if('sinerFile' in tempParams) {
        // 删除临时项目文件
        deleteFile(sinerFile);
      }
      if (params.imgDir) {
        // 删除临时文件夹
        // deleteDirectoryFile(params.imgDir);
      }
      if (error) {
        let tempError = error.message || stderr || stdout;
        if (/spawn .* ENOENT/.test(tempError)) {
          tempError = FormatMessage.string({id: 'config.JavaHomeConfigResult.notFoundJDK'});
        } else if (/java\.lang\.OutOfMemoryError/.test(tempError)) {
          tempError = FormatMessage.string({id: 'config.JavaHomeConfigResult.outOfMemoryError'});
        }
        cb && cb({
          status : "FAILED",
          body: tempError,
        });
      } else {
        readJsonPromise(outFile).then((d) => {
          // GenExcelImpl 成功后、向用户报告成功前，把上游产品表头适配为
          // CS-M（见 workbook_branding.js）；适配失败按导出失败反馈，
          // 不吞异常，避免把未适配文件当成功导出展示。
          if (cmd === 'GenExcelImpl' && d && d.status === 'SUCCESS'
              && typeof d.body === 'string' && /\.xlsx$/i.test(d.body)) {
            try {
              brandExcelFile(d.body);
            } catch (err) {
              cb && cb({
                status: 'FAILED',
                body: `brandWorkbook: ${err.message || err}`,
              });
              return;
            }
          }
          cb && cb(d);
        }).catch(err => {
          cb && cb({
            status : "FAILED",
            body : err.message,
          });
        }).finally(() => {
          // 删除该文件
          deleteFile(outFile);
        });
      }
      //const result = (stdout || stderr || error.message);
      //cb && cb(error ? result : null);
    });
};

export const copyFile = (defaultPath, filters) => {
  return new Promise((res, rej) => {
    dialog.showSaveDialog({
      defaultPath: (filters || [])[0]?.name,
      filters: filters || []
    }).then(({filePath}) => {
      if (filePath) {
        readNormalFile(defaultPath).then(data => saveNormalFile(filePath, data))
          .then(() => res(filePath)).catch(rej);
      } else {
        res();
      }
    }).catch((err) => {
      rej(err);
    });
  });
};

export const saveTempImages = (images, imageType) => {
  // 创建临时目录
  const userConfigPath = basePath + path.sep + 'temp_img';
  // 删除临时文件夹
  deleteDirectoryFile(userConfigPath);
  // 重新创建临时文件夹
  ensureDirectoryExistence(userConfigPath);
  return new Promise((res, rej) => {
    Promise.all(images.map(i => {
      const filePath = userConfigPath + path.sep + (i.group ? `${i.group}-${i.fileName}` : i.fileName) + `.${imageType}`;
      return saveNormalFile(filePath, i.data);
    })).then(() => {
      res(userConfigPath);
    }).catch((err) => {
      rej(err);
    })
  });
};

export const saveImages = (images, imageType) => {
  return new Promise((res, rej) => {
    openFileOrDirPath([], ['openDirectory']).then((p) => {
      if (p) {
        Promise.all(images.map(i => {
          const filePath = p + path.sep + i.fileName + '.' + imageType;
          const dataBuffer = Buffer.from(i.data.replace(/^data:image\/\w+\+*\w+;base64,/, ""), 'base64');
          return saveNormalFile(filePath, dataBuffer);
        })).then(() => {
          res();
        }).catch((err) => {
          rej(err);
        })
      } else {
        res();
      }
    }).catch((err) => {
      rej(err);
    })
  });
};

const getDefaultTemplate = (ext, name) => {
  return ipcRenderer.sendSync('template', {ext, name});
}

export const saveAsTemplate = (name, ext) => {
  return copyFile(getDefaultTemplate(ext, name), [{name: name, extensions: [ext]}]).catch((err) => {
    Modal.error({title: FormatMessage.string({id: 'optFail'}), message: err.message || err});
  });
};

export const selectDir = (name, type) => {
  return new Promise((res, rej) => {
    openFileOrDirPath([], ['openDirectory']).then((dir) => {
      res(dir ? `${dir}${path.sep}${name}-${moment().format('YYYYMDHHmmss')}.${type}` : undefined);
    }).catch(rej);
  })
}

export const selectWordFile = (dataSource, template) => {
  const name = _.get(dataSource, 'name');
  let defaultPath = template || getDefaultTemplate('docx', 'CS-M-docx-tpl');
  return new Promise((res, rej) => {
    openFileOrDirPath([], ['openDirectory']).then((dir) => {
      res(dir ? [`${dir}${path.sep}${name}-${moment().format('YYYYMDHHmmss')}.docx`, defaultPath] : undefined);
    }).catch(rej);
  })
};

export const writeLog = (err) => {
  const logPath = `${basePath}${path.sep}${moment().format('YYYY-M-D-HH-mm-ss')}-error-log.txt`;
  return saveNormalFile(logPath, err.stack || String(err)).then(() => logPath);
};

export const getLogPath = () => {
  return path.join(app.getPath('home'), '/logs/chiner');
}

export const showItemInFolder = () => {
  shell.openPath(getLogPath());
}

export const showErrorLogFolder = (file) => {
  shell.openPath(file);
}

export const basename = (fileName, extension) => {
  return path.basename(fileName, extension);
}

export const getBackupAllFile = ({info, data}, callback) => {
  if (info) {
    try {
      const dir = path.join(path.dirname(info), `.back_${data.name}`);
      // 文件名-backup-${年月日时分秒}.chnr.json
      //const name = basename(info, '.json');
      ensureDirectoryExistence(dir);
      const reg = new RegExp(`T\(\\d)+.pdma.json`);
      fs.readdir(dir, (error, files) => {
        if (!error) {
          try {
            const allFiles = files.filter(f => reg.test(f)).sort((a, b) => {
              return a.match(/(\d)+/)[0] - b.match(/(\d)+/)[0];
            });
            // 默认保存100条历史数据
            if (allFiles.length >= 100) {
              // 删除最旧的
              const file = path.join(dir, allFiles[0]);
              if (fs.existsSync(file)) {
                fs.unlinkSync(file);
              }
            }
            const fileName = `T${moment().format('YYYYMMDDHHmmss')}.pdma.json`;
            fs.writeFileSync(path.join(dir, fileName), JSON.stringify(data));
            callback && callback();
          } catch (e) {
            callback && callback(e);
          }
        } else {
          callback && callback(error);
        }
      });
    } catch (e) {
      callback && callback(e);
    }
  } else {
    callback && callback();
  }
};

export const getBackupAllFileData = ({info, data}, callback) => {
  if (info) {
    try {
      const dir = path.join(path.dirname(info), `.back_${data.name}`);
      const reg = new RegExp(`T\(\\d)+.pdma.json`);
      fs.readdir(dir, (error, files) => {
        if (!error) {
          try {
            const allFiles = files.filter(f => reg.test(f))
                .sort((a, b) => {
              return b.match(/(\d)+/)[0] - a.match(/(\d)+/)[0];
            }).map(f => {
                  return {
                    file: f.match(/T(\d)+/)[0],
                    path: path.join(dir, f)
                  }
                });
            callback && callback(allFiles);
          } catch (e) {
            callback && callback([]);
          }
        } else {
          callback && callback([]);
        }
      });
    } catch (e) {
      callback && callback([]);
    }
  } else {
    callback([])
  }
}

export const deleteVersion = (versionData, dataSource, info) => {
  const versionDir = path.join(path.dirname(info), `.version_${dataSource.name}`);
  const oldVersionPath = path.join(versionDir, `${versionData.name}.json`);
  if (fs.existsSync(oldVersionPath)) {
    deleteFile(oldVersionPath);
  }
};

export const saveVersion = (versionData, oldVersion, info, dataSource) => {
  const versionDir = path.join(path.dirname(info), `.version_${dataSource.name}`);
  ensureDirectoryExistence(versionDir);
  const filePath = path.join(versionDir, `${versionData.name}.json`);
  return saveJsonPromise(filePath, versionData, true).then((result) => {
    // 原子提交成功后再移除改名前的版本，同名更新由原子保存保护。
    if (oldVersion && oldVersion.name !== versionData.name) {
      deleteVersion(oldVersion, dataSource, info);
    }
    return result;
  });
};

const renameProjectDirectory =
    (prefix, oldFilePath, newFilePath, oldData, newData, validateOnly) => {
  const oldDir = path.join(path.dirname(oldFilePath), `${prefix}${oldData.name}`);
  const newDir = path.join(path.dirname(newFilePath), `${prefix}${newData.name}`);
  if (oldDir === newDir) return () => {};
  // 即使源目录不存在也不能复用其他项目的历史目录。
  if (fs.existsSync(newDir)) {
    const error = new Error(`Project history directory already exists: ${newDir}`);
    error.code = 'EEXIST';
    throw error;
  }
  if (validateOnly || !fs.existsSync(oldDir)) return () => {};
  ensureDirectoryExistence(path.dirname(newDir));
  fs.renameSync(oldDir, newDir);
  return () => fs.renameSync(newDir, oldDir);
};

export const renameVersion = (oldFilePath, newFilePath, oldData, newData, validateOnly = false) => {
  return renameProjectDirectory('.version_', oldFilePath, newFilePath, oldData, newData, validateOnly);
};

export const renameBackupAllFile =
    (oldFilePath, newFilePath, oldData, newData, validateOnly = false) => {
  return renameProjectDirectory('.back_', oldFilePath, newFilePath, oldData, newData, validateOnly);
};

export const saveAllTemplate = (data, filePath) => {
  try {
    return Promise.all(data.filter(d => d.suffix).map(d => {
      const file = path.join(filePath, d.suffix);
      ensureDirectoryExistence(dirname(file));
      return new Promise((res, rej) => {
        saveNormalFile(file, d.code).then(() => {
          res(file);
        }).catch(err => rej(err))
      });
    }));
  } catch (e) {
    return Promise.reject(e);
  }
};

export const extractFile = (filePath) => {
  return readNormalFile(filePath);
};


export const getFilePath = (path) => {
  return ipcRenderer.sendSync('loadFile',{path});
}
