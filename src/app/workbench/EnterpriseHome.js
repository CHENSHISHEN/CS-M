/**
 * DATA-WB-FEAT-003 / S3 企业首页：直接可编辑的企业架构画布
 *
 * 布局 = 蓝色品牌标题条（企业名/介绍编辑 + 旧封面入口）+ 高占比直接编辑画布。
 * 画布本体（增删改/连接/撤销重做/平移缩放/MIME 拖放/diagram 引用）见 EnterpriseHomeCanvas。
 * props 与既有签名兼容：dataSource/updateDataSource/readOnly/onOpenDiagram/onCreateDiagram/
 * onOpenCoverDiagram；新增可选 getDataSource（最新有效草稿，保存合并基准）与
 * addRequest:{kind,nonce}（ModelCatalog 点击添加请求）。文案为局部中英字典，不改语言文件。
 */
import React from 'react';
import {Button, Icon, Modal, openModal} from 'components';
import {getEnterpriseModeling} from '../../lib/model_catalog';
import {homeLabel, writeEnterpriseInfo} from '../../lib/enterprise_home';
import {getMemoryCache} from '../../lib/cache';
import {CONFIG} from '../../lib/variable';
import EnterpriseHomeCanvas from './EnterpriseHomeCanvas';
import {WbIcon} from './icons';
import './style/enterprise-home.less';

const currentLang = () => {
  const config = getMemoryCache(CONFIG);
  return (config && config.lang) || 'zh';
};
const L = key => homeLabel(currentLang(), key);

const EnterpriseHome = ({dataSource, getDataSource, updateDataSource, readOnly,
                          addRequest, onOpenDiagram, onCreateDiagram, onOpenCoverDiagram}) => {
  const meta = getEnterpriseModeling(dataSource);
  // 名称/介绍保存同样基于最新草稿合并，保留 homeCanvas/概览 pin/旧封面等全部既有元数据
  const editEnterprise = () => {
    const base = (getDataSource ? getDataSource() : dataSource) || {};
    const stored = base?.profile?.enterpriseModeling || {};
    const draft = {name: stored.name || '', description: stored.description || ''};
    let modal;
    const formId = Math.uuid();
    const save = () => {
      const name = draft.name.trim();
      if (!name) { Modal.error({title: L('nameRequired')}); return; }
      // S3-HOME-REVIEW 第4条：确认时重新读最新草稿合并，
      // 只更新 name/description，不回退弹窗打开后其他 tab 的修改（含 homeCanvas）
      const fresh = (getDataSource ? getDataSource() : dataSource) || {};
      updateDataSource && updateDataSource(writeEnterpriseInfo(fresh, {
        name,
        description: draft.description.trim(),
      }));
      modal.close();
    };
    modal = openModal(<form
      className='chiner-ehome-form'
      id={formId}
      onSubmit={(e) => { e.preventDefault(); save(); }}>
      <label htmlFor={`${formId}-name`}>
        <span>{L('name')}<em> *</em></span>
        <input
          id={`${formId}-name`}
          defaultValue={draft.name}
          maxLength='100'
          onChange={(e) => { draft.name = e.target.value; }}/>
      </label>
      <label htmlFor={`${formId}-desc`}>
        <span>{L('description')}</span>
        <textarea
          id={`${formId}-desc`}
          rows='4'
          defaultValue={draft.description}
          maxLength='500'
          onChange={(e) => { draft.description = e.target.value; }}/>
      </label>
    </form>, {
      title: L('editTitle'),
      bodyStyle: {width: 480},
      buttons: [
        <Button key='ok' type='primary' onClick={save}>{L('confirm')}</Button>,
        <Button key='cancel' onClick={() => modal.close()}>{L('cancel')}</Button>,
      ],
    });
  };
  return <div className='chiner-ehome'>
    <header className='chiner-ehome-header'>
      <div className='chiner-ehome-heading'>
        <span className='chiner-ehome-logo' aria-hidden='true'><WbIcon name='diagram' size={18}/></span>
        <div className='chiner-ehome-text'>
          <h1 title={meta.name}>{meta.name}</h1>
          {meta.description && <p title={meta.description}>{meta.description}</p>}
        </div>
      </div>
      <div className='chiner-ehome-actions'>
        {!readOnly && <button type='button' className='chiner-ehome-action' onClick={editEnterprise}>
          <Icon type='fa-edit'/>
          <span>{L('editTitle')}</span>
        </button>}
        {onOpenCoverDiagram && <button
          type='button'
          className='chiner-ehome-action'
          onClick={onOpenCoverDiagram}
          title={L('openCover')}
          aria-label={L('openCover')}>
          <Icon type='fa-image'/>
          <span>{L('openCover')}</span>
        </button>}
      </div>
    </header>
    <div className='chiner-ehome-body'>
      <EnterpriseHomeCanvas
        dataSource={dataSource}
        getDataSource={getDataSource}
        updateDataSource={updateDataSource}
        readOnly={readOnly}
        addRequest={addRequest}
        onOpenDiagram={onOpenDiagram}
        onCreateDiagram={onCreateDiagram}
      />
    </div>
  </div>;
};

export default React.memo(EnterpriseHome);
