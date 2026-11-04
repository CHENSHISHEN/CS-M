import React, { useState, useMemo } from 'react';
import _ from 'lodash/object';
import { Icon, Modal, openModal, Button, FormatMessage, SearchInput, Tooltip } from 'components';
import { platform } from '../../lib/middle';
import ProjectEdit from '../container/projectedit';
import { getPrefix } from '../../lib/prefixUtil';
import { openUrl } from '../../lib/json2code_util';
import template from '../../lib/template';
import { READING } from '../../lib/variable';
import { moduleRegistry, MODULE_IDS } from '../../lib/moduleRegistry';
import CreateProjectModal from './CreateProjectModal';

// 二维码浮层组件（兼容旧测试与操作手册）
const CodeImg = ({ currentPrefix }) => {
  return (
    <div className={`${currentPrefix}-home-container-codeimg`}>
      <div><FormatMessage id='home.optBookTitle' /></div>
      <div>
        <div>
          <img src='./asset/codeimage/img.png' alt='' />
          <span><FormatMessage id='home.optBookTitle1' /></span>
        </div>
      </div>
    </div>
  );
};

// 模块卡片示意图组件
const ModuleIllustrations = {
  [MODULE_IDS.DATA]: () => (
    <svg width='180' height='70' viewBox='0 0 180 70' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <rect x='10' y='10' width='60' height='48' rx='4' fill='#ffffff' stroke='#1890ff' strokeWidth='1.5' />
      <rect x='10' y='10' width='60' height='14' rx='4' fill='#e6f7ff' />
      <line x1='10' y1='24' x2='70' y2='24' stroke='#1890ff' strokeWidth='1' />
      <rect x='16' y='15' width='24' height='4' rx='1' fill='#1890ff' />
      <line x1='16' y1='32' x2='42' y2='32' stroke='#8c8c8c' strokeWidth='1.5' strokeLinecap='round' />
      <line x1='16' y1='40' x2='54' y2='40' stroke='#bfbfbf' strokeWidth='1.5' strokeLinecap='round' />
      <line x1='16' y1='48' x2='38' y2='48' stroke='#bfbfbf' strokeWidth='1.5' strokeLinecap='round' />

      <path d='M70 34 H110' stroke='#1890ff' strokeWidth='1.5' strokeDasharray='3 3' />
      <circle cx='70' cy='34' r='2' fill='#1890ff' />
      <path d='M104 30 L110 34 L104 38' stroke='#1890ff' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' />

      <rect x='110' y='10' width='60' height='48' rx='4' fill='#ffffff' stroke='#1890ff' strokeWidth='1.5' />
      <rect x='110' y='10' width='60' height='14' rx='4' fill='#e6f7ff' />
      <line x1='110' y1='24' x2='170' y2='24' stroke='#1890ff' strokeWidth='1' />
      <rect x='116' y='15' width='28' height='4' rx='1' fill='#1890ff' />
      <line x1='116' y1='32' x2='148' y2='32' stroke='#8c8c8c' strokeWidth='1.5' strokeLinecap='round' />
      <line x1='116' y1='40' x2='158' y2='40' stroke='#bfbfbf' strokeWidth='1.5' strokeLinecap='round' />
      <line x1='116' y1='48' x2='140' y2='48' stroke='#bfbfbf' strokeWidth='1.5' strokeLinecap='round' />
    </svg>
  ),
  [MODULE_IDS.BUSINESS]: () => (
    <svg width='180' height='70' viewBox='0 0 180 70' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <rect x='5' y='6' width='170' height='26' rx='3' fill='#f6ffed' stroke='#b7eb8f' strokeWidth='1' />
      <rect x='5' y='36' width='170' height='28' rx='3' fill='#f6ffed' stroke='#b7eb8f' strokeWidth='1' />
      <text x='10' y='22' fontSize='8' fill='#52c41a' fontFamily='sans-serif'>销售</text>
      <text x='10' y='53' fontSize='8' fill='#52c41a' fontFamily='sans-serif'>主管</text>

      <circle cx='38' cy='19' r='6' fill='#e6fffb' stroke='#13c2c2' strokeWidth='1.5' />
      <line x1='44' y1='19' x2='56' y2='19' stroke='#13c2c2' strokeWidth='1.2' />

      <rect x='56' y='11' width='44' height='16' rx='3' fill='#ffffff' stroke='#13c2c2' strokeWidth='1.2' />
      <line x1='62' y1='19' x2='90' y2='19' stroke='#13c2c2' strokeWidth='1' strokeLinecap='round' />

      <path d='M100 19 H118 V42' stroke='#13c2c2' strokeWidth='1.2' fill='none' />
      <polygon points='128,42 140,50 128,58 116,50' fill='#ffffff' stroke='#faad14' strokeWidth='1.2' />

      <path d='M140 50 H154' stroke='#13c2c2' strokeWidth='1.2' />
      <circle cx='160' cy='50' r='6' fill='#13c2c2' />
    </svg>
  ),
  [MODULE_IDS.DRAWING]: () => (
    <svg width='180' height='70' viewBox='0 0 180 70' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <rect x='65' y='8' width='50' height='22' rx='3' fill='#ffffff' stroke='#fa8c16' strokeWidth='1.5' />
      <line x1='72' y1='19' x2='108' y2='19' stroke='#fa8c16' strokeWidth='1.5' strokeLinecap='round' />

      <path d='M90 30 V42 M90 42 H45 V48 M90 42 H135 V48' stroke='#fa8c16' strokeWidth='1.2' fill='none' />

      <rect x='25' y='48' width='40' height='16' rx='2' fill='#fff7e6' stroke='#fa8c16' strokeWidth='1' />
      <rect x='115' y='48' width='40' height='16' rx='2' fill='#fff7e6' stroke='#fa8c16' strokeWidth='1' />

      <rect x='138' y='6' width='26' height='20' rx='1' fill='#fffbe6' stroke='#ffe58f' strokeWidth='1' />
      <line x1='142' y1='12' x2='158' y2='12' stroke='#faad14' strokeWidth='1' strokeLinecap='round' />
      <line x1='142' y1='17' x2='154' y2='17' stroke='#faad14' strokeWidth='1' strokeLinecap='round' />
    </svg>
  ),
};

export default React.memo(({
  prefix,
  importProject,
  createProject,
  openTemplate,
  renameProject,
  updateHistory,
  deleteProject,
  lang,
  config,
}) => {
  const currentPrefix = getPrefix(prefix);
  const [searchValue, setSearchValue] = useState('');
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'data' | 'business' | 'drawing'
  const [activeNav, setActiveNav] = useState('home'); // 'home' | 'recent' | 'templates'
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createInitialMode, setCreateInitialMode] = useState(MODULE_IDS.DATA);

  const modules = useMemo(() => moduleRegistry.getModules(), []);

  const openCreateModal = (modeId = MODULE_IDS.DATA) => {
    setCreateInitialMode(modeId);
    setCreateModalVisible(true);
  };

  const handleCreateConfirm = (projectData, dirPath) => {
    createProject(projectData, dirPath);
    setCreateModalVisible(false);
  };

  const proInfo = (h) => {
    Modal.info({
      title: FormatMessage.string({ id: 'home.proInfo' }),
      message: <ProjectEdit data={h} reading lang={lang} />,
      contentStyle: {
        height: '60vh',
        overflow: 'auto',
      },
    });
  };

  const proConfig = (projectData) => {
    let modal = null;
    let newDataSource = {};
    let oldData = {};
    const onOk = () => {
      if (!newDataSource.name || (!newDataSource.path && platform === 'json')) {
        Modal.error({
          title: FormatMessage.string({ id: 'optFail' }),
          message: FormatMessage.string({ id: 'formValidateMessage' }),
        });
      } else {
        if (projectData && Object.keys(oldData).length > 0) {
          renameProject(newDataSource, oldData, projectData);
        }
        modal && modal.close();
      }
    };
    const onCancel = () => {
      modal && modal.close();
    };
    const onChange = (project) => {
      newDataSource = project;
    };
    const dataFinish = (data) => {
      if (data) {
        newDataSource = data;
        oldData = data;
      } else {
        modal && modal.close();
      }
    };
    modal = openModal(
      <ProjectEdit
        data={projectData}
        lang={lang}
        onChange={onChange}
        dataFinish={dataFinish}
      />,
      {
        title: FormatMessage.string({ id: 'home.editProject' }),
        buttons: [
          <Button type='primary' key='ok' onClick={onOk}>
            <FormatMessage id='button.ok' />
          </Button>,
          <Button key='onCancel' onClick={onCancel}>
            <FormatMessage id='button.cancel' />
          </Button>,
        ],
      }
    );
  };

  const removeHistoryItem = (h) => {
    updateHistory('remove', h);
  };

  const removeProjectDisk = (h) => {
    Modal.confirm({
      title: FormatMessage.string({ id: 'deleteConfirmTitle' }),
      message: FormatMessage.string({ id: 'deleteFromDiskConfirm' }),
      lang,
      onOk: () => {
        deleteProject(h);
      },
    });
  };

  const openTemplateClick = (tplData, tKey) => {
    openTemplate(tplData, tKey);
  };

  const onProjectClick = (h) => {
    importProject(h.path);
  };

  const handleModuleAction = (mod) => {
    if (mod.isReady) {
      openCreateModal(mod.id);
    } else {
      Modal.info({
        title: FormatMessage.string({ id: 'home.comingSoon' }),
        message: `${FormatMessage.string({ id: mod.nameKey })}: ${FormatMessage.string({ id: 'home.underDevTip' })}`,
      });
    }
  };

  const handleTemplateFeatureClick = (type) => {
    if (type === 'data') {
      const firstTplKey = Object.keys(template)[0];
      if (firstTplKey && template[firstTplKey]) {
        openTemplateClick(template[firstTplKey], firstTplKey);
      }
    } else if (type === 'drawing') {
      openCreateModal(MODULE_IDS.DRAWING);
    } else {
      openCreateModal(MODULE_IDS.BUSINESS);
    }
  };

  // 过滤项目历史
  const reg = useMemo(
    () => new RegExp((searchValue || '').replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i'),
    [searchValue]
  );

  const rawHistories = config?.data[0]?.projectHistories || [];
  const filteredHistories = useMemo(() => {
    return rawHistories.filter((p) => {
      const matchesSearch = reg.test(p.describe || '') || reg.test(p.name || '') || reg.test(p.path || '');
      if (!matchesSearch) return false;

      if (activeFilter === 'all') return true;
      const pModule = p.module || 'data';
      return pModule === activeFilter;
    });
  }, [rawHistories, reg, activeFilter]);

  // 行右侧下拉工具菜单
  const RowActionMenu = ({ p }) => {
    const [menuOpen, setMenuOpen] = useState(false);

    return (
      <div
        className={`${currentPrefix}-project-center-row-actions ${currentPrefix}-home-container-body-right-list-tab-item-tool`}
      >
        <span
          className='action-btn'
          title={FormatMessage.string({ id: 'home.proInfo' })}
          onClick={(e) => {
            e.stopPropagation();
            proInfo(p);
          }}
        >
          <Icon type='icon-xinxi' />
        </span>
        <span
          className='action-btn'
          title={FormatMessage.string({ id: 'home.editProject' })}
          onClick={(e) => {
            e.stopPropagation();
            proConfig(p);
          }}
        >
          <Icon type='edit.svg' />
        </span>
        <span
          className='action-btn more-btn'
          onMouseEnter={() => setMenuOpen(true)}
          onMouseLeave={() => setMenuOpen(false)}
        >
          <span>
            <Icon type='more.svg' />
          </span>
          <span
            className={`${currentPrefix}-project-center-dropdown`}
            style={{ display: menuOpen ? 'block' : 'none' }}
          >
            <div
              className='dropdown-item'
              onClick={(e) => {
                e.stopPropagation();
                importProject(p.path, READING);
              }}
            >
              <Icon type='fa-eye' style={{ marginRight: 6 }} />
              <FormatMessage id='home.openReading' />
            </div>
            <div
              className='dropdown-item'
              onClick={(e) => {
                e.stopPropagation();
                removeHistoryItem(p);
              }}
            >
              <Icon type='fa-minus-circle' style={{ marginRight: 6 }} />
              <FormatMessage id='home.removeHistory' />
            </div>
            <div
              className='dropdown-item danger'
              onClick={(e) => {
                e.stopPropagation();
                removeProjectDisk(p);
              }}
            >
              <Icon type='fa-trash' style={{ marginRight: 6 }} />
              <FormatMessage id='home.removeProject' />
            </div>
          </span>
        </span>
      </div>
    );
  };

  return (
    <div className={`${currentPrefix}-project-center-shell ${currentPrefix}-home-container`}>
      {/* 1. 顶部 Header (高 56px) */}
      <div className={`${currentPrefix}-project-center-header`}>
        <div className={`${currentPrefix}-project-center-brand`}>
          <div className='brand-icon'>P</div>
          <div className='brand-title'>
            <span className='brand-name'>PDManer</span>
            <span className='brand-sub'>
              <FormatMessage id='home.projectCenter' />
            </span>
          </div>
        </div>
        <div className={`${currentPrefix}-project-center-header-right`}>
          <div className='search-wrap'>
            <SearchInput
              placeholder={FormatMessage.string({ id: 'home.search' })}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
            />
          </div>
          <Button icon='fa-folder-open' onClick={() => importProject()}>
            <FormatMessage id='toolbar.open' />
          </Button>
          <Button type='primary' icon='fa-plus' onClick={() => openCreateModal(MODULE_IDS.DATA)}>
            <FormatMessage id='home.createProject' />
          </Button>
        </div>
      </div>

      {/* 2. 主体区 (左侧导览 + 右侧主内容) */}
      <div className={`${currentPrefix}-project-center-body`}>
        {/* 左侧工作空间侧栏 (宽 180px) */}
        <div className={`${currentPrefix}-project-center-sidebar`}>
          <div className='sidebar-section-title'>
            <FormatMessage id='home.workspaceNav' />
          </div>
          <div className='sidebar-nav-list'>
            <div
              className={`sidebar-nav-item ${activeNav === 'home' ? 'active' : ''}`}
              onClick={() => setActiveNav('home')}
            >
              <Icon type='fa-th-large' />
              <span>
                <FormatMessage id='home.projectCenter' />
              </span>
            </div>
            <div
              className={`sidebar-nav-item ${activeNav === 'recent' ? 'active' : ''}`}
              onClick={() => setActiveNav('recent')}
            >
              <Icon type='fa-clock-o' />
              <span>
                <FormatMessage id='home.recentNav' />
              </span>
            </div>
            <div
              className={`sidebar-nav-item ${activeNav === 'templates' ? 'active' : ''}`}
              onClick={() => setActiveNav('templates')}
            >
              <Icon type='fa-cubes' />
              <span>
                <FormatMessage id='home.templateNav' />
              </span>
            </div>
          </div>

          <div className='sidebar-divider' />

          <div className='sidebar-info-block'>
            <div className='info-title'>
              <FormatMessage id='home.localOffline' />
            </div>
            <div className='info-sub'>数据保存在你的本地项目目录</div>
          </div>

          {/* 底部设置与文档 */}
          <div className='sidebar-footer'>
            <Tooltip placement='right' title={<CodeImg currentPrefix={currentPrefix} />} force>
              <div
                className={`sidebar-footer-item ${currentPrefix}-home-container-body-right-nav-type-unselected`}
                onClick={() => openUrl('https://www.yuque.com/pdmaner/docs')}
                title={FormatMessage.string({ id: 'home.jumpOptBook' })}
              >
                <Icon type='fa-book' />
                <span>
                  <FormatMessage id='home.optBook' />
                </span>
              </div>
            </Tooltip>
            <div
              className={`sidebar-footer-item ${currentPrefix}-home-container-body-right-nav-type-unselected`}
              onClick={() => openUrl('http://pdmaas.pdmaner.com/')}
              title={FormatMessage.string({ id: 'home.page' })}
            >
              <Icon type='fa-globe' />
              <span>
                <FormatMessage id='home.page' />
              </span>
            </div>
          </div>
        </div>

        {/* 右侧主视口 */}
        <div className={`${currentPrefix}-project-center-content`}>
          <div className='content-inner'>
            {/* 标语区 */}
            {activeNav === 'home' && (
              <>
                <div className={`${currentPrefix}-project-center-hero`}>
                  <div className='hero-title'>
                    <FormatMessage id='home.slogan' />
                  </div>
                  <div className='hero-desc'>
                    <FormatMessage id='home.sloganDesc' />
                  </div>
                </div>

                {/* 三大模块入口卡片 */}
                <div className={`${currentPrefix}-project-center-module-cards`}>
                  {modules.map((m) => {
                    const IllustrationComponent = ModuleIllustrations[m.id];
                    return (
                      <div
                        key={m.id}
                        className={`${currentPrefix}-project-center-module-card`}
                        style={{ borderTop: `3px solid ${m.accentColor}` }}
                      >
                        <div className='card-preview' style={{ background: m.tintColor }}>
                          {IllustrationComponent && <IllustrationComponent />}
                          {!m.isReady && (
                            <span className='coming-soon-badge' style={{ background: m.accentColor }}>
                              <FormatMessage id={m.badgeKey} />
                            </span>
                          )}
                        </div>
                        <div className='card-body'>
                          <div className='card-title-row'>
                            <span className='card-title'>
                              <FormatMessage id={m.nameKey} />
                            </span>
                            <span className='card-sub'>
                              <FormatMessage id={m.subKey} />
                            </span>
                          </div>
                          <div className='card-desc'>
                            <FormatMessage id={m.descKey} />
                          </div>
                          <div className='card-action-row'>
                            <Button
                              type='primary'
                              onClick={() => handleModuleAction(m)}
                              style={{
                                background: m.accentColor,
                                borderColor: m.accentColor,
                              }}
                            >
                              <FormatMessage id={m.actionKey} />
                              {!m.isReady && ' (开发中)'}
                            </Button>
                            {!m.sharedProject && (m.isReady ? (
                              <span
                                className='card-template-link'
                                onClick={() => handleTemplateFeatureClick(m.key)}
                              >
                                <FormatMessage id='home.startFromTemplate' />
                              </span>
                            ) : (
                              <span
                                className='card-template-link muted'
                                onClick={() => handleTemplateFeatureClick(m.key)}
                              >
                                {m.id === MODULE_IDS.BUSINESS ? (
                                  <FormatMessage id='home.viewProcessExample' />
                                ) : (
                                  <FormatMessage id='home.viewArchExample' />
                                )}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* 继续工作（最近项目列表） */}
            {(activeNav === 'home' || activeNav === 'recent') && (
              <div className={`${currentPrefix}-project-center-recent-section`}>
                <div className='section-header'>
                  <div className='section-title'>
                    <FormatMessage id='home.continueWork' />
                    <span className='count-badge'>({filteredHistories.length})</span>
                  </div>
                  <div className='filter-tabs'>
                    {[
                      { key: 'all', label: 'home.filterAll' },
                      { key: 'data', label: 'home.filterData' },
                      { key: 'business', label: 'home.filterBusiness' },
                      { key: 'drawing', label: 'home.filterDrawing' },
                    ].map((tab) => (
                      <span
                        key={tab.key}
                        className={`filter-tab ${activeFilter === tab.key ? 'active' : ''}`}
                        onClick={() => setActiveFilter(tab.key)}
                      >
                        <FormatMessage id={tab.label} />
                      </span>
                    ))}
                  </div>
                </div>

                {/* 列表表格 */}
                <div className={`${currentPrefix}-project-center-table`}>
                  <div className='table-head'>
                    <div className='col col-name'>
                      <FormatMessage id='home.colProjectName' />
                    </div>
                    <div className='col col-doc'>
                      <FormatMessage id='home.colRecentDoc' />
                    </div>
                    <div className='col col-loc'>
                      <FormatMessage id='home.colLocation' />
                    </div>
                    <div className='col col-mod'>
                      <FormatMessage id='home.colModule' />
                    </div>
                    <div className='col col-time'>
                      <FormatMessage id='home.colLastModified' />
                    </div>
                    <div className='col col-act'>
                      <FormatMessage id='home.colActions' />
                    </div>
                  </div>

                  <div className='table-body'>
                    {filteredHistories.length > 0 ? (
                      filteredHistories.map((p) => {
                        const pModule = p.module || 'data';
                        const modColor =
                          pModule === 'business' ? '#13c2c2' : pModule === 'drawing' ? '#fa8c16' : '#1890ff';
                        const modLabel =
                          pModule === 'business'
                            ? FormatMessage.string({ id: 'home.filterBusiness' })
                            : pModule === 'drawing'
                            ? FormatMessage.string({ id: 'home.filterDrawing' })
                            : FormatMessage.string({ id: 'home.filterData' });

                        return (
                          <div
                            key={p.path}
                            className={`table-row ${currentPrefix}-home-container-body-right-list-tab-item`}
                            onClick={() => onProjectClick(p)}
                            title={p.path}
                          >
                            <div className='col col-name'>
                              <span className='proj-icon'>
                                {p.avatar ? (
                                  <img src={p.avatar} alt='icon' />
                                ) : (
                                  <Icon type='fa-folder' style={{ color: modColor }} />
                                )}
                              </span>
                              <span className={`proj-name ${currentPrefix}-home-container-body-right-list-tab-item-title`}>
                                {p.name}
                              </span>
                            </div>
                            <div className='col col-doc'>{p.describe || '—'}</div>
                            <div className='col col-loc' title={p.path}>
                              {p.path}
                            </div>
                            <div className='col col-mod'>
                              <span
                                className='module-tag'
                                style={{
                                  color: modColor,
                                  borderColor: modColor,
                                  background: `${modColor}15`,
                                }}
                              >
                                {modLabel}
                              </span>
                            </div>
                            <div className='col col-time'>{p.time || '—'}</div>
                            <div className='col col-act' onClick={(e) => e.stopPropagation()}>
                              <RowActionMenu p={p} />
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className='table-empty'>
                        <Icon type='fa-folder-open-o' style={{ fontSize: 36, color: '#bfbfbf', marginBottom: 8 }} />
                        <div>
                          {searchValue ? (
                            <FormatMessage id='home.noMatchingProjects' />
                          ) : (
                            <FormatMessage id='home.noProjects' />
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 模板精选区（展示 3 个内置示例模板） */}
            {(activeNav === 'home' || activeNav === 'templates') && (
              <div className={`${currentPrefix}-project-center-templates-section`}>
                <div className='section-title'>
                  <FormatMessage id='home.templateFeatured' />
                </div>
                <div className='template-cards'>
                  {Object.keys(template).map((tKey, idx) => {
                    const tpl = template[tKey];
                    const iconType = idx === 0 ? 'fa-table' : idx === 1 ? 'fa-graduation-cap' : 'fa-shopping-cart';
                    const iconColor = idx === 0 ? '#1890ff' : idx === 1 ? '#13c2c2' : '#fa8c16';
                    const iconBg = idx === 0 ? '#e6f7ff' : idx === 1 ? '#e6fffb' : '#fff7e6';

                    return (
                      <div
                        key={tpl.name || tKey}
                        className={`template-card ${currentPrefix}-home-container-body-right-list-tab-item`}
                        onClick={() => openTemplateClick(tpl, tKey)}
                      >
                        <div className='tpl-icon-box' style={{ background: iconBg, color: iconColor }}>
                          <Icon type={iconType} />
                        </div>
                        <div className='tpl-info'>
                          <div className={`tpl-name ${currentPrefix}-home-container-body-right-list-tab-item-title`}>
                            {tpl.name}
                          </div>
                          <div className='tpl-desc'>{tpl.describe || tpl.name}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. 底部状态栏 */}
      <div className={`${currentPrefix}-project-center-footer`}>
        <div className='footer-left'>
          <span className='status-dot' />
          <span>本地项目中心 · 离线可用</span>
        </div>
        <div className='footer-right'>
          <span>CS-M 建模平台</span>
        </div>
      </div>

      {/* 4. 创建项目弹窗 (UI-P07) */}
      <CreateProjectModal
        prefix={prefix}
        visible={createModalVisible}
        initialMode={createInitialMode}
        onOk={handleCreateConfirm}
        onCancel={() => setCreateModalVisible(false)}
      />
    </div>
  );
});
