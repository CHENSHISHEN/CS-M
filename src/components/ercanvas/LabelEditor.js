import React, { useState } from 'react';
import { Input, Radio, FormatMessage } from 'components';

import './style/index.less';
import {getPrefix} from '../../lib/prefixUtil';

const RadioGroup = Radio.Group;

export default React.memo(({ prefix, value, lineStyle = 'solid', onChange, onLineStyleChange, isLogic = false }) => {
  const [currentLineStyle, setCurrentLineStyle] = useState(lineStyle);
  const _onChange = (e) => {
    onChange && onChange(e.target.value);
  };
  const _onLineStyleChange = (e) => {
    const val = e.target.value;
    setCurrentLineStyle(val);
    onLineStyleChange && onLineStyleChange(val);
  };
  const currentPrefix = getPrefix(prefix);
  return <div className={`${currentPrefix}-label-editor`}>
    {isLogic && (
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '12px', color: '#595959', marginBottom: '6px' }}>
          <FormatMessage id='modelCatalog.relationType' defaultMessage='关系类型' />:
        </div>
        <RadioGroup value={currentLineStyle} onChange={_onLineStyleChange}>
          <Radio value='solid'>
            <FormatMessage id='modelCatalog.identifyingRelation' defaultMessage='识别关系 (实线)' />
          </Radio>
          <Radio value='dotted-large'>
            <FormatMessage id='modelCatalog.nonIdentifyingRelation' defaultMessage='非识别关系 (虚线)' />
          </Radio>
        </RadioGroup>
      </div>
    )}
    <div>
      {isLogic && (
        <div style={{ fontSize: '12px', color: '#595959', marginBottom: '6px' }}>
          <FormatMessage id='canvas.edge.relationLabel' defaultMessage='业务标签' />:
        </div>
      )}
      <Input defaultValue={value} placeholder={isLogic ? FormatMessage.string({id: 'modelCatalog.conceptRelation', defaultMessage: '业务关联标签'}) : ''} onChange={_onChange}/>
    </div>
  </div>;
});
