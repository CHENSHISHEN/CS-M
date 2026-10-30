import React, { useState, useMemo } from 'react';
import { Icon, Modal, openModal, Button, FormatMessage, SearchInput } from 'components';
import { platform } from '../../lib/middle';
import ProjectEdit from '../container/projectedit';
import { getPrefix } from '../../lib/prefixUtil';
import template from '../../lib/template';
import { READING } from '../../lib/variable';
import CreateProjectModal from './CreateProjectModal';

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
  const [activeNav, setActiveNav] = useState('home'); // 'home' | 'recent' | 'templates'
  const [createModalVisible, setCreateModalVisible] = useState(false);

  const openCreateModal = () => {
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

  // 过滤项目历史
  const reg = useMemo(
    () => new RegExp((searchValue || '').replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i'),
    [searchValue]
  );

  const rawHistories = config?.data[0]?.projectHistories || [];
  const filteredHistories = useMemo(() => {
    return rawHistories.filter((p) => {
      return reg.test(p.describe || '') || reg.test(p.name || '') || reg.test(p.path || '');
    });
  }, [rawHistories, reg]);

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
          <div className='brand-icon'><img src='./branding/logo.png' alt='CS-M' /></div>
          <div className='brand-title'>
            <span className='brand-name'>CS-M</span>
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
          <Button type='primary' icon='fa-plus' onClick={openCreateModal}>
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
        </div>

        {/* 右侧主视口 */}
        <div className={`${currentPrefix}-project-center-content`}>
          <div className='content-inner'>
            {/* 标语区 */}
            {activeNav === 'home' && (
              <div className={`${currentPrefix}-project-center-hero`}>
                <div className='hero-title'>
                  <FormatMessage id='home.slogan' />
                </div>
                <div className='hero-desc'>
                  <FormatMessage id='home.sloganDesc' />
                </div>
              </div>
            )}

            {/* 继续工作（最近项目列表） */}
            {(activeNav === 'home' || activeNav === 'recent') && (
              <div className={`${currentPrefix}-project-center-recent-section`}>
                <div className='section-header'>
                  <div className='section-title'>
                    <FormatMessage id='home.continueWork' />
                    <span className='count-badge'>({filteredHistories.length})</span>
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
                                  <Icon type='fa-folder' style={{ color: '#1890ff' }} />
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

      {/* 4. 创建项目弹窗 */}
      <CreateProjectModal
        prefix={prefix}
        visible={createModalVisible}
        onOk={handleCreateConfirm}
        onCancel={() => setCreateModalVisible(false)}
      />
    </div>
  );
});
