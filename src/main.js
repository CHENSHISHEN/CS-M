/* eslint-disable */
const {app, BrowserWindow, Menu, nativeImage, ipcMain, dialog} = require('electron');
const fs = require('fs');
const path = require('path');
const url = require('url');

// 单实例锁：多开会共用 userData/drawing-autosave（自动保存目录与写锁），必须在任何启动副作用
// （IPC 注册、DrawingPersistence、窗口创建）之前获取。拿不到锁说明已有实例在运行：
// 已有实例会收到 second-instance 并聚焦主窗口，本实例直接退出。
// main.js 由 Node CommonJS 包装加载，模块顶层 return 合法（与 bin/start.js 同一做法），
// 可确保下面注册的 ready/IPC 等逻辑在第二个实例中一行都不执行。
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

require('@electron/remote/main').initialize();

// AI Host Broker（纯 CommonJS，开发态 src/host/ai、成品经 webpack 复制到 build/host/ai，路径一致）
const {createAiHostBroker, registerAiHostIpc} = require('./host/ai');
const aiBroker = createAiHostBroker();
const aiIpc = registerAiHostIpc({ipcMain, broker: aiBroker});
// 只在真正退出时清理（will-quit 不可被绘图关闭守卫取消）；
// before-quit 可能被 preventDefault 取消退出，若提前 dispose 会导致取消退出后 AI 通道失效
app.on('will-quit', () => {aiIpc.dispose();});

// 导航守卫：窗口开启了 nodeIntegration，禁止被导航到/弹出远程或本地任意页面（外链交系统浏览器打开），
// 仅放行同一文档（刷新/hash）与应用自身页面的新窗口（成品经 webpack 复制到 build/lib，路径一致）
const {installNavigationGuard} = require('./lib/navigationGuard');
app.on('web-contents-created', (event, contents) => {installNavigationGuard(contents);});

// 保持一个对于 window 对象的全局引用，如果你不这样做，
// 当 JavaScript 对象被垃圾回收， window 会被自动地关闭
let win;
const {DrawingPersistence} = require(process.env.CHINER_NODE_ENV === 'development' ? '../public/drawing-persistence' : './drawing-persistence');
let drawingStore;
let closeAllowed = false;
let closePending = false;
let quitRequested = false;
const closeRequests = new Map();
ipcMain.handle('drawing-persistence', async (event, request) => {
  try {
    if (!drawingStore || !win || event.sender !== win.webContents) throw Error('Invalid drawing session');
    const owner = String(event.sender.id);
    const {method, file} = request;
    if (!['open','command','flush','repair','recovery','versions','version','saveVersion','deleteVersion'].includes(method)) throw Error('Unknown drawing operation');
    let value;
    if (method === 'open') value = await drawingStore.open(file, request.baseline, owner);
    if (method === 'command') value = await drawingStore.command(file, request.command, owner);
    if (method === 'flush') value = await drawingStore.flush(file, owner, request.candidate);
    if (method === 'repair') value = await drawingStore.repair(file, request.snapshot, owner);
    if (method === 'recovery') value = await drawingStore.recovery(file, owner);
    if (method === 'versions') value = await drawingStore.versions(file, owner);
    if (method === 'saveVersion') value = await drawingStore.saveVersion(file, request.name, owner);
    if (method === 'deleteVersion') value = await drawingStore.deleteVersion(file, request.name, owner);
    if (method === 'version') value = await drawingStore.version(file, request.name, owner);
    return {ok:true, value};
  } catch (error) {return {ok:false,error:error.message};}
});
ipcMain.on('drawing-close-ready', (event, response) => {
  if (win && event.sender === win.webContents) closeRequests.get(response.requestId)?.(response);
});
const requestDrawingClose = async (transition='close') => {
  if (closePending || !win) return;
  closePending = true;
  try {
    const requestId = Date.now().toString();
    const result = await new Promise(resolve => {
      const timeout = setTimeout(() => {closeRequests.delete(requestId);resolve({ok:false,error:'The editor did not finish saving. Try again or export a recovery copy.'});}, 20000);
      closeRequests.set(requestId, value => {clearTimeout(timeout);closeRequests.delete(requestId);resolve(value);});
      win.webContents.send('drawing-before-close', requestId);
    });
    if (!result.ok) {
      const choice = await dialog.showMessageBox(win, {type:'warning',message:result.recoveryAvailable ? '项目未写入，绘图已保存在本机恢复区。 / Drawing retained in local recovery.' : '绘图尚未落盘，放弃会丢失未保存操作。 / Unsaved drawing operations remain.',detail:result.error || '',buttons:['取消 / Cancel',result.recoveryAvailable ? '保留本机恢复副本并关闭 / Keep recovery and close' : '放弃未落盘操作并关闭 / Discard unsaved operations'],defaultId:0,cancelId:0});
      if (choice.response !== 1) {quitRequested = false;return;}
    }
    if (result.legacyDirty) {
      const decision = await dialog.showMessageBox(win, {type:'warning',message:'数据或业务模型仍有未保存的编辑。 / Unsaved model edits remain.',buttons:['取消 / Cancel','放弃模型编辑并关闭 / Discard model edits'],defaultId:0,cancelId:0});
      if (decision.response !== 1) {quitRequested = false;return;}
    }
    if(transition==='reload'&&!quitRequested){win.webContents.reload();return;}
    closeAllowed = true;
    if (quitRequested) app.quit();else win.close();
  } finally {closePending = false;}
};
app.on('before-quit', event => {
  if (win && !closeAllowed) {event.preventDefault();quitRequested = true;requestDrawingClose();}
});

function createWindow() {
  closeAllowed = false;
  drawingStore = new DrawingPersistence(path.join(app.getPath('userData'), 'drawing-autosave'), {
    notify: state => {if (win && !win.isDestroyed()) {const {drawings, ...summary} = state;win.webContents.send('drawing-save-state', summary);}},
  });
  // 创建浏览器窗口。
  win = new BrowserWindow({
    width: 1220,
    height: 600,
    minWidth: 1024,
    minHeight: 600,
    frame: false,
    resizable: false,
    show: false,
    //titleBarStyle: 'customButtonsOnHover',
    backgroundColor: 'transparent',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
    }
  });

  // AI 窄 IPC：attach 本窗口 webContents（窗口 destroyed 由 Host 自动清理订阅与在途请求）
  aiIpc.attachWindow(win.webContents);

  // 然后加载应用的 index.html。
  if (process.env.CHINER_NODE_ENV === 'development') {
    var profile = require('../profile');
    win.loadURL(`http://${profile.host}:${profile.port}/index.html`);
    // 打开开发者工具。
    win.setIcon(
        nativeImage.createFromPath(
            path.join(__dirname, "../public/branding/logo.png")
        )
    );
    win.webContents.openDevTools();
  } else {
    //win.webContents.openDevTools();
    win.loadURL(url.format({
      pathname: path.join(__dirname, 'index.html'),
      protocol: 'file:',
      slashes: true,
    }));
    win.setIcon(
        nativeImage.createFromPath(
            path.join(__dirname, "branding/logo.png")
        )
    );
  }
  win.webContents.on('before-input-event',(event,input)=>{if(input.type==='keyDown'&&(input.meta||input.control)&&input.key.toLowerCase()==='r'){event.preventDefault();requestDrawingClose('reload');}});
  win.on('close', event => {if (!closeAllowed) {event.preventDefault();requestDrawingClose();}});
  win.on('ready-to-show', function () {
    win.show();
  });
  let dataCache = {};
  const sendMessage = (reason) => {
    if (dataCache.data && dataCache.info) {
      const dir = path.dirname(dataCache.info);
      const time = new Date(+ new Date() + 8 * 3600 * 1000 ).toJSON()
        .substr(0,19).replace("T","")
        .replaceAll('-', '')
        .replaceAll(':', '');
      fs.writeFile(path.join(dir, `/${dataCache.data.name}-backup-${time}.chnr.json`), JSON.stringify(dataCache.data, null, 2), () => {
      });
    }
  }
  ipcMain.on('data', (e, args ) => {
    try {
      const argData = JSON.parse(args);
      if (argData.next && argData.next.core) {
        dataCache = argData.next.core;
      } else if (argData.pre && argData.pre.core) {
        dataCache = argData.pre.core;
      }
    } catch (e) {

    }
  });
  // 监听进程崩溃 或者网页无响应时
  win.webContents.on('render-process-gone', (event, details ) => {
    sendMessage(details.reason);
  });
  win.webContents.on('unresponsive', () => {
    sendMessage('unresponsive');
  });

  // 当 window 被关闭，这个事件会被触发。
  win.on('closed', () => {
    // 取消引用 window 对象，如果你的应用支持多窗口的话，
    // 通常会把多个 window 对象存放在一个数组里面，
    // 与此同时，你应该删除相应的元素。
    win = null;
  });
  ipcMain.on("jarPath", (event) => {
    let jarPath = '';
    if (process.env.CHINER_NODE_ENV === 'development') {
      jarPath = path.join(__dirname, '../public/jar/pdmaner-java.jar');
    } else {
      jarPath = path.join(__dirname, '../../app.asar.unpacked/build/jar/pdmaner-java.jar')
    }
    event.returnValue = jarPath;
  });
  ipcMain.on("template", (event, {ext, name}) => {
    let template = '';
    const fileName = `${name}.${ext}`;
    if (process.env.CHINER_NODE_ENV === 'development') {
      template = path.join(__dirname, `../public/file/${fileName}`);
    } else {
      template = path.join(__dirname, `../../app.asar.unpacked/build/file/${fileName}`)
    }
    event.returnValue = template;
  });
  ipcMain.on("loadFile", (event, args) => {
    let urlPtah = '';
    if (process.env.CHINER_NODE_ENV === 'development') {
      urlPtah = `http://${profile.host}:${profile.port}/index.html?path=${args.path}`;
    } else {
      urlPtah = path.join(__dirname, `index.html?path=${args.path}`)
    }
    event.returnValue = urlPtah;
  });
  let menu;
  // 设置菜单
  if (process.platform === 'darwin') {
    const template = [
      {
        role: 'appMenu',
        submenu: [
          {role: 'about'},
          {type: 'separator'},
          {type: 'separator'},
          {role: 'hide'},
          {role: 'hideothers'},
          {role: 'unhide'},
          {type: 'separator'},
          {role: 'quit'}
        ]
      },
      {
        role: 'editMenu',
        submenu: [
          {role: 'undo'},
          {role: 'redo'},
          {type: 'separator'},
          {role: 'cut'},
          {role: 'copy'},
          {role: 'paste'},
          {role: 'pasteandmatchstyle'},
          {role: 'delete'},
          {role: 'selectall'},
          {type: 'separator'},
        ]
      },
      {
        role: 'windowMenu',
        submenu: [
          {role: 'minimize'},
          {role: 'close'},
          {role: 'zoom'},
          {role: 'front'}
        ]
      }
    ]
    menu = Menu.buildFromTemplate(template);
  } else {
    menu = null;
  }
  Menu.setApplicationMenu(menu);
}

// Electron 会在初始化后并准备
// 创建浏览器窗口时，调用这个函数。
// 部分 API 在 ready 事件触发后才能使用。
app.on('ready', createWindow);

// 第二个实例启动时（已被上方单实例锁拦下）：恢复并聚焦已有窗口，优先主窗口。
// 本应用没有从命令行参数打开工程文件的机制，commandLine 不做处理。
app.on('second-instance', () => {
  const target = (win && !win.isDestroyed()) ? win : (BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]);
  if (target) {
    if (target.isMinimized()) target.restore();
    target.focus();
  } else if (win === null && app.isReady() && !quitRequested) {
    // 与 activate 一致：主窗口已关闭（macOS 不随窗口全关退出）时重新创建
    createWindow();
  }
});

// 当全部窗口关闭时退出。
app.on('window-all-closed', () => {
  // 在 macOS 上，除非用户用 Cmd + Q 确定地退出，
  // 否则绝大部分应用及其菜单栏会保持激活。
  if (process.platform !== 'darwin') {
  app.quit();
}
});

app.on('activate', () => {
  //在macOS上，当单击dock图标并且没有其他窗口打开时，
  // 通常在应用程序中重新创建一个窗口。
  if (win === null) {
  createWindow();
}
});
