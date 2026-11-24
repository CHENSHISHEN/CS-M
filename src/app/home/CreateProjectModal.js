import React, { useEffect, useState } from 'react';
import { Modal, Input, PathSelectInput, FormatMessage, Button, Icon } from 'components';
import { platform } from '../../lib/middle';
import { getPrefix } from '../../lib/prefixUtil';
import templateData from '../../lib/template';
import { moduleRegistry, MODULE_IDS } from '../../lib/moduleRegistry';
import { createDefaultBusinessModel } from '../../lib/businessStorage';

export default React.memo(({
  prefix,
  visible,
  initialMode = MODULE_IDS.DATA,
  onOk,
  onCancel,
}) => {
  const currentPrefix = getPrefix(prefix);
  // 指标平台与数据建模共享项目,不能作为新建类型,回退到数据建模
  const safeInitialMode = moduleRegistry.getProjectCreatableModules().some(m => m.id === initialMode) ? initialMode : MODULE_IDS.DATA;
  const [selectedMode, setSelectedMode] = useState(safeInitialMode);
  const [name, setName] = useState('');
  const [dirPath, setDirPath] = useState('');
  const [describe, setDescribe] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('blank'); // 'blank' or template key

  const modules = moduleRegistry.getProjectCreatableModules();
  useEffect(() => {
    if (visible) {setSelectedMode(safeInitialMode);if (safeInitialMode !== MODULE_IDS.DATA) setSelectedTemplate('blank');}
  }, [visible, safeInitialMode]);

  const handleModeChange = (modeId) => {
    setSelectedMode(modeId);
    if (modeId !== MODULE_IDS.DATA) {
      setSelectedTemplate('blank');
    }
  };

  const handleConfirm = () => {
    const trimmedName = (name || '').trim();
    if (!trimmedName) {
      Modal.error({
        title: FormatMessage.string({ id: 'optFail' }),
        message: FormatMessage.string({ id: 'formValidateMessage' }),
      });
      return;
    }
    if (platform === 'json' && !dirPath) {
      Modal.error({
        title: FormatMessage.string({ id: 'optFail' }),
        message: FormatMessage.string({ id: 'formValidateMessage' }),
      });
      return;
    }

    // Build project payload
    let projectPayload = {
      name: trimmedName,
      describe: describe || trimmedName,
      module: selectedMode === MODULE_IDS.DRAWING ? 'drawing' : (selectedMode === MODULE_IDS.BUSINESS ? 'business' : 'data'),
    };

    if (selectedMode === MODULE_IDS.BUSINESS) {
      projectPayload.business = createDefaultBusinessModel();
    } else if (selectedMode === MODULE_IDS.DRAWING) {
      projectPayload.drawings = [];
    } else if (selectedTemplate && selectedTemplate !== 'blank' && templateData[selectedTemplate]) {
      const tpl = templateData[selectedTemplate];
      projectPayload = {
        ...tpl,
        name: trimmedName,
        describe: describe || tpl.describe || trimmedName,
        module: 'data',
      };
    }

    onOk && onOk(projectPayload, dirPath);
  };

  if (!visible) return null;

  return (
    <div className={`${currentPrefix}-create-proj-modal-overlay`}>
      <div className={`${currentPrefix}-create-proj-modal`}>
        {/* Header */}
        <div className={`${currentPrefix}-create-proj-modal-header`}>
          <div>
            <div className={`${currentPrefix}-create-proj-modal-title`}>
              <FormatMessage id='home.createProject' />
            </div>
            <div className={`${currentPrefix}-create-proj-modal-subtitle`}>
              <FormatMessage id='home.workModeSubtitle' />
            </div>
          </div>
          <span className={`${currentPrefix}-create-proj-modal-close`} onClick={onCancel}>
            ×
          </span>
        </div>

        {/* Body */}
        <div className={`${currentPrefix}-create-proj-modal-body`}>
          {/* Mode Selector */}
          <div className={`${currentPrefix}-create-proj-modes`}>
            {modules.map((m) => {
              const isSelected = selectedMode === m.id;
              return (
                <div
                  key={m.id}
                  className={`${currentPrefix}-create-proj-mode-card ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleModeChange(m.id)}
                  style={{
                    borderColor: isSelected ? m.accentColor : undefined,
                    background: isSelected ? m.tintColor : undefined,
                  }}
                >
                  <div className={`${currentPrefix}-create-proj-mode-card-header`}>
                    <span
                      className={`${currentPrefix}-create-proj-mode-card-icon`}
                      style={{ color: m.accentColor }}
                    >
                      <Icon type={m.icon === 'table' ? 'fa-table' : m.icon === 'flow' ? 'fa-sitemap' : 'fa-th-large'} />
                    </span>
                    <span className={`${currentPrefix}-create-proj-mode-card-title`}>
                      <FormatMessage id={m.nameKey} />
                    </span>
                    {!m.isReady && (
                      <span className={`${currentPrefix}-create-proj-mode-card-badge`}>
                        <FormatMessage id={m.badgeKey} />
                      </span>
                    )}
                  </div>
                  <div className={`${currentPrefix}-create-proj-mode-card-sub`}>
                    <FormatMessage id={m.subKey} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Form Fields */}
          <div className={`${currentPrefix}-create-proj-form`}>
            {/* Project Name */}
            <div className={`${currentPrefix}-create-proj-form-item`}>
              <label>
                <span className='required'>*</span> <FormatMessage id='home.colProjectName' />
              </label>
              <Input
                placeholder={FormatMessage.string({ id: 'home.search' })}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* Project Directory */}
            {platform === 'json' && (
              <div className={`${currentPrefix}-create-proj-form-item`}>
                <label>
                  <span className='required'>*</span> <FormatMessage id='home.projectLocation' />
                </label>
                <PathSelectInput
                  placeholder={FormatMessage.string({ id: 'home.projectLocationPlaceholder' })}
                  title={FormatMessage.string({ id: 'home.selectDir' })}
                  value={dirPath}
                  onChange={(val) => setDirPath(val)}
                />
              </div>
            )}

            {/* Description */}
            <div className={`${currentPrefix}-create-proj-form-item`}>
              <label>
                <FormatMessage id='project.describe' />
              </label>
              <Input
                placeholder={FormatMessage.string({ id: 'project.describe' })}
                value={describe}
                onChange={(e) => setDescribe(e.target.value)}
              />
            </div>

            {/* Initial Template */}
            <div className={`${currentPrefix}-create-proj-form-item`}>
              <label>
                <FormatMessage id='home.startTemplate' />
              </label>
              {selectedMode === MODULE_IDS.DATA ? (
                <div className={`${currentPrefix}-create-proj-templates`}>
                  <div
                    className={`${currentPrefix}-create-proj-template-item ${selectedTemplate === 'blank' ? 'selected' : ''}`}
                    onClick={() => setSelectedTemplate('blank')}
                  >
                    <div className={`${currentPrefix}-create-proj-template-item-name`}>
                      <Icon type='fa-file-o' style={{ marginRight: 6 }} />
                      <FormatMessage id='home.blankProject' />
                    </div>
                    <div className={`${currentPrefix}-create-proj-template-item-desc`}>
                      <FormatMessage id='home.blankProjectDesc' />
                    </div>
                  </div>
                  {Object.keys(templateData).map((k) => {
                    const tpl = templateData[k];
                    return (
                      <div
                        key={k}
                        className={`${currentPrefix}-create-proj-template-item ${selectedTemplate === k ? 'selected' : ''}`}
                        onClick={() => setSelectedTemplate(k)}
                      >
                        <div className={`${currentPrefix}-create-proj-template-item-name`}>
                          <Icon type='fa-table' style={{ marginRight: 6, color: '#1890ff' }} />
                          {tpl.name}
                        </div>
                        <div className={`${currentPrefix}-create-proj-template-item-desc`}>
                          {tpl.describe || tpl.name}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : selectedMode === MODULE_IDS.BUSINESS ? (
                <div className={`${currentPrefix}-create-proj-template-item selected`}>
                  <div className={`${currentPrefix}-create-proj-template-item-name`}>
                    <Icon type='fa-sitemap' style={{ marginRight: 6, color: '#13c2c2' }} />
                    <FormatMessage id='home.orderProcess' />
                  </div>
                  <div className={`${currentPrefix}-create-proj-template-item-desc`}>
                    <FormatMessage id='home.orderProcessDesc' /> (开发中)
                  </div>
                </div>
              ) : (
                <div className={`${currentPrefix}-create-proj-template-item selected`}>
                  <div className={`${currentPrefix}-create-proj-template-item-name`}>
                    <Icon type='fa-th-large' style={{ marginRight: 6, color: '#fa8c16' }} />
                    <FormatMessage id='home.drawingPlatformSubtitle' />
                  </div>
                  <div className={`${currentPrefix}-create-proj-template-item-desc`}>
                    <FormatMessage id='platformV3.createHint' />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={`${currentPrefix}-create-proj-modal-footer`}>
          <Button onClick={onCancel}>
            <FormatMessage id='button.cancel' />
          </Button>
          <Button type='primary' onClick={handleConfirm}>
            <FormatMessage id='home.createProject' />
          </Button>
        </div>
      </div>
    </div>
  );
});
