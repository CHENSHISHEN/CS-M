import React, { useState } from 'react';
import { Modal, Input, PathSelectInput, FormatMessage, Button, Icon } from 'components';
import { platform } from '../../lib/middle';
import { getPrefix } from '../../lib/prefixUtil';
import templateData from '../../lib/template';

export default React.memo(({
  prefix,
  visible,
  onOk,
  onCancel,
}) => {
  const currentPrefix = getPrefix(prefix);
  const [name, setName] = useState('');
  const [dirPath, setDirPath] = useState('');
  const [describe, setDescribe] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('blank'); // 'blank' or template key

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
    };

    if (selectedTemplate && selectedTemplate !== 'blank' && templateData[selectedTemplate]) {
      const tpl = templateData[selectedTemplate];
      projectPayload = {
        ...tpl,
        name: trimmedName,
        describe: describe || tpl.describe || trimmedName,
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
                  placeholder={FormatMessage.string({ id: 'project.path.placeholder' })}
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
