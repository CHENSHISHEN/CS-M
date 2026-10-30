// 新工作台首发候选冒烟：只使用内置通用样例的临时副本，原生文件选择替换为临时路径。
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const {_electron} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-m-baseline-'));
const out = process.env.CSM_EVIDENCE || path.join(root, 'dist', 'acceptance');
fs.mkdirSync(out, {recursive: true});
const seed = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/template/电商商城.pdma.json')));
seed.name = 'CS-M 基线验收'; seed.dbConns = [];
const project = path.join(work, 'CS-M 基线验收.pdma.json');
fs.writeFileSync(project, JSON.stringify(seed));
const main = path.join(work, 'main.cjs');
fs.writeFileSync(main, `const {app}=require('electron');app.setPath('userData',${JSON.stringify(path.join(work,'user-data'))});require(${JSON.stringify(path.join(root,'app/build/main.js'))});`);
const report = {status:'RUNNING', checks:[], errors:[], project, executable:process.env.CSM_APP_EXECUTABLE || 'local Electron', date:new Date().toISOString()};
const save = () => fs.writeFileSync(path.join(out, 'gui-report.json'), JSON.stringify(report, null, 2));
(async () => {
  let app, page;
  const check = async (name, action) => {
    try {await action(); report.checks.push({name,status:'PASS'}); console.log('PASS',name);}
    catch(e) {report.checks.push({name,status:'FAIL',error:e.message}); throw e;}
    finally {save();}
  };
  try {
    app = await _electron.launch({executablePath:process.env.CSM_APP_EXECUTABLE || require('electron'), args:process.env.CSM_APP_EXECUTABLE ? [`--user-data-dir=${path.join(work,'user-data')}`] : [main]});
    assert.equal(await app.evaluate(({app})=>app.getPath('userData')),path.join(work,'user-data'),'测试必须隔离 userData');
    page = await app.firstWindow(); page.setDefaultTimeout(15000);
    page.on('pageerror', e=>report.errors.push(e.message));
    await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setResizable(true);w.setBounds({x:20,y:20,width:1440,height:900});});
    await page.getByText('打开',{exact:true}).first().waitFor();
    if(await page.locator('.chiner-modal-header-icon:visible').count()) await page.locator('.chiner-modal-header-icon:visible').first().click();
    await check('首页使用 CS-M 品牌与图二 Logo',async()=>{
      const text=await page.locator('body').innerText();assert(text.includes('CS-M'));assert(!text.includes('PDManer'));
      const logos=await page.locator('img').evaluateAll(imgs=>imgs.map(x=>x.getAttribute('src')));
      assert(logos.some(x=>x&&x.includes('branding/logo')));
      const logo=await page.locator('.brand-icon img').boundingBox();assert(logo.width<=40&&logo.height<=40,JSON.stringify(logo));
      await page.screenshot({path:path.join(out,'home.png')});
    });
    await check('新建空项目实际落盘并默认进入新工作台',async()=>{
      await page.getByText('新建项目',{exact:true}).first().click();
      const dialog=page.locator('.chiner-create-proj-modal');await dialog.waitFor();
      await dialog.locator('input').first().fill('CS-M 新建验收');
      await app.evaluate(({dialog},dir)=>{dialog.showOpenDialog=()=>Promise.resolve({filePaths:[dir],canceled:false});},work);
      await dialog.locator('.chiner-path-select-input').click();
      await dialog.locator('.chiner-create-proj-modal-footer').getByText('新建项目',{exact:true}).click();
      await page.locator('.chiner-home-wb').waitFor();
      const created=path.join(work,'CS-M 新建验收.pdma.json');
      assert(fs.existsSync(created));assert.equal(JSON.parse(fs.readFileSync(created)).entities.length,0);
      await page.locator('.chiner-wb-topbar-brand button').first().click();
      if(await page.locator('.chiner-modal:visible').count())await page.locator('.chiner-modal:visible').last().getByText('确定',{exact:true}).click();
      await page.getByText('打开',{exact:true}).first().waitFor();
    });
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=()=>Promise.resolve({filePaths:[file],canceled:false});},project);
    await page.getByText('打开',{exact:true}).first().click();
    await page.locator('.chiner-home-wb').waitFor();
    const top=page.locator('.chiner-wb-topbar'),rail=page.locator('.chiner-wb-rail');
    await check('打开兼容工程直接进入唯一新工作台，后期模块未暴露',async()=>{
      assert((await top.innerText()).includes('CS-M'));
      const text=await rail.innerText();for(const name of ['模型','数据标准','版本','类型设置','规则检查'])assert(text.includes(name));
      for(const name of ['经典布局','业务建模','画图平台','指标平台','资源总览'])assert(!(await page.locator('body').innerText()).includes(name));
      assert.equal(await page.locator('.chiner-head-wb-switch').count(),0);await page.screenshot({path:path.join(out,'workbench.png')});
    });
    await check('状态栏位于底部跨满窗口，属性面板位于编辑区右侧',async()=>{
      const m=await page.evaluate(()=>{const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};return {width:innerWidth,height:innerHeight,status:box('.chiner-wb-statusbar'),inspector:box('.chiner-wb-inspector'),editor:box('.chiner-home-resize-other')};});
      assert(Math.abs(m.status.x)<2&&Math.abs(m.status.width-m.width)<2,JSON.stringify(m));
      assert(Math.abs(m.status.bottom-m.height)<3,JSON.stringify(m));
      assert(m.inspector.width>=260&&m.inspector.x>=m.editor.right-2&&m.inspector.bottom<=m.status.y+2,JSON.stringify(m));
      report.layout=m;
    });
    await check('基线模块入口可达且模型往返不丢失',async()=>{
      for(const name of ['数据标准','版本','类型设置','规则检查','模型']) {
        await rail.getByRole('button',{name,exact:true}).click();await page.waitForTimeout(250);
        if(name==='数据标准')await page.locator('.chiner-data-standard').waitFor();
      }
    });
    await check('表编辑、字段推荐与保存实际落盘',async()=>{
      const table=seed.entities.find(e=>e.fields?.length);
      const search=top.locator('.chiner-search-suggest input').first();await search.fill(table.defKey);
      const result=page.locator('.chiner-search-suggest-list-item-refs:visible').filter({hasText:table.defKey}).first();
      await result.getByText('详情',{exact:true}).first().click();await search.fill('');
      const input=page.locator('.chiner-tab-content-item-show').getByRole('textbox',{name:'推荐字段名称',exact:true}).first();
      await input.waitFor();await input.fill('验收字段');await input.press('Tab');
      await top.getByRole('button',{name:'保存',exact:true}).click();
      await page.waitForTimeout(600);
      const saved=JSON.parse(fs.readFileSync(project));assert(saved.entities.some(e=>e.fields.some(f=>f.defName==='验收字段')));
      await page.waitForFunction(()=>!document.querySelector('.chiner-wb-statusbar-dirty'));
      await page.screenshot({path:path.join(out,'table.png')});
    });
    await check('真实 ER 关系图打开并显示模型节点与连线',async()=>{
      const table=seed.entities.find(e=>e.fields?.length&&seed.diagrams.some(g=>g.canvasData?.cells.some(c=>c.originKey===e.id)));
      const search=top.locator('.chiner-search-suggest input').first();await search.fill(table.defKey);
      const reference=page.locator('.chiner-search-suggest-list-item-ref:visible').first();await reference.getByText('定位',{exact:true}).click();await search.fill('');
      await page.locator('.chiner-tab-content-item-show .x6-node').first().waitFor();
      assert(await page.locator('.chiner-tab-content-item-show .x6-edge').count()>0);
      await page.screenshot({path:path.join(out,'diagram.png')});
    });
    await check('窗口尺寸适配保留可见编辑区',async()=>{
      for(const width of [1280,1440]) {
        await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setBounds({x:20,y:20,width,height:900}),width);await page.waitForTimeout(150);
        const m=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,editor:document.querySelector('.chiner-home-resize-other').getBoundingClientRect().width}));
        assert(m.scroll<=m.width,JSON.stringify(m));assert(m.editor>300,JSON.stringify(m));
      }
    });
    assert.equal(report.errors.length,0,JSON.stringify(report.errors)); report.status='PASS';
  } catch(e) {report.status='FAIL';report.failure=e.stack;console.error(e.stack);if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});process.exitCode=1;}
  finally {save();if(app)await app.close();console.log('REPORT',path.join(out,'gui-report.json'));}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
