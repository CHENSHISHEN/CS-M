import React, {forwardRef, useImperativeHandle, useState, useEffect, useRef} from 'react';
import {FormatMessage, Icon, Slider, Tooltip} from 'components';
import numeral from 'numeral';
import {getPrefix} from '../../lib/prefixUtil';
import { addBodyEvent, removeBodyEvent } from '../../lib/listener';

export default React.memo(forwardRef(({prefix, redo, undo, setSelection,
                                          sliderChange, setMinimap, modelLevel, displayMode, onDisplayModeChange}, ref) => {
    const sliderIconRef = useRef(null);
    const sliderRef = useRef(null);
    const displayIconRef = useRef(null);
    const displayMenuRef = useRef(null);
    const [historyStatus, setHistoryStatus] = useState([true, true]);
    const [enableSelection, setEnableSelection] = useState(true);
    const [scaleNumber, setScaleNumber] = useState(1);
    const [mapOpen, setMapOpen] = useState(false);
    const [sliderOpen, setSliderOpen] = useState(false);
    const [displayMenuOpen, setDisplayMenuOpen] = useState(false);
    const _setEnableSelection = (v) => {
        setEnableSelection(v);
        setSelection(v);
    };
    const _setMapOpen = () => {
        setMapOpen(!mapOpen);
        setMinimap();
    };
    const _setSliderOpen = () => {
        setSliderOpen(pre => !pre);
    };
    const getDisplayOptions = () => {
        if (modelLevel === 'conceptual') {
            return [
                { key: 'detailed', label: FormatMessage.string({id: 'workbench.displayModeConceptDetailed', defaultMessage: '完整业务卡片 (含定义)'}) },
                { key: 'compact', label: FormatMessage.string({id: 'workbench.displayModeConceptCompact', defaultMessage: '紧凑卡片 (仅名称)'}) },
            ];
        }
        if (modelLevel === 'logical') {
            return [
                { key: 'all', label: FormatMessage.string({id: 'workbench.displayModeLogicalAll', defaultMessage: '完整逻辑属性'}) },
                { key: 'name', label: FormatMessage.string({id: 'workbench.displayModeLogicalName', defaultMessage: '仅逻辑名称'}) },
                { key: 'pk', label: FormatMessage.string({id: 'workbench.displayModeLogicalPk', defaultMessage: '仅主标识符 (PK)'}) },
            ];
        }
        return [
            { key: 'all', label: FormatMessage.string({id: 'workbench.displayModeAll', defaultMessage: '代码[名称] (完整)'}) },
            { key: 'key', label: FormatMessage.string({id: 'workbench.displayModeKey', defaultMessage: '仅物理代码 (Code)'}) },
            { key: 'name', label: FormatMessage.string({id: 'workbench.displayModeName', defaultMessage: '仅逻辑名称 (Name)'}) },
            { key: 'pk', label: FormatMessage.string({id: 'workbench.displayModePk', defaultMessage: '主键摘要 (仅PK)'}) },
        ];
    };
    useEffect(() => {
        const eventId = Math.uuid();
        const eventName = 'onclick';
        addBodyEvent(eventName, eventId, (e) => {
            if ((e.target !== sliderIconRef.current) && (e.target !== sliderRef.current)
                && (!sliderRef.current?.contains(e.target))) {
                setSliderOpen(false);
            }
            if ((e.target !== displayIconRef.current) && (e.target !== displayMenuRef.current)
                && (!displayMenuRef.current?.contains(e.target))) {
                setDisplayMenuOpen(false);
            }
        });
        return () => {
            removeBodyEvent(eventName, eventId);
        };
    }, []);
    useImperativeHandle(ref,() => {
        return {
            historyChange: ({undoStack, redoStack}) => {
                setHistoryStatus([undoStack.length === 0, redoStack.length === 0]);
            },
            scaleChange: (scale) => {
                setScaleNumber(scale);
            },
            setMinimap: () => {
                setMapOpen(pre => !pre);
            },
        };
    }, []);
    const currentPrefix = getPrefix(prefix);
    return <div className={`${currentPrefix}-relation-toolbar`}>
      <div className={`${currentPrefix}-relation-toolbar-item`}>
        <Tooltip
          offsetTop={2}
          title={FormatMessage.string({id: 'toolbar.undo'})}
          force
          placement='top'>
          <Icon onClick={undo} type='icon-bianzu4' disable={historyStatus[0]}/>
        </Tooltip>
        <div className={`${currentPrefix}-relation-toolbar-line`}/>
        <Tooltip
          offsetTop={2}
          title={FormatMessage.string({id: 'toolbar.redo'})}
          force
          placement='top'>
          <Icon onClick={redo} type='icon-bianzu3' disable={historyStatus[1]}/>
        </Tooltip>
      </div>
      <div className={`${currentPrefix}-relation-toolbar-item`}>
        <Tooltip
          offsetTop={4}
          title={FormatMessage.string({id: 'toolbar.selection'})}
          force
          placement='top'>
          <Icon
            onClick={() => _setEnableSelection(!enableSelection)}
            type={enableSelection ? 'fa-hand-pointer-o' : 'fa-hand-rock-o'}/>
        </Tooltip>
        <div className={`${currentPrefix}-relation-toolbar-line`}/>
        <span className={`${currentPrefix}-relation-toolbar-size`}>
          <Tooltip
            offsetTop={2}
            title={FormatMessage.string({id: 'toolbar.resetScale'})}
            force
            placement='top'>
            <span onClick={() => sliderChange('fit')}>{parseInt(numeral(scaleNumber).multiply(100).value(), 10)}%</span>
          </Tooltip>
          <Icon ref={sliderIconRef} onClick={_setSliderOpen} type='fa-caret-down'/>
        </span>
        <Tooltip
          offsetTop={2}
          title={FormatMessage.string({id: 'toolbar.map'})}
          force
          placement='top'>
          <Icon
            className={`${currentPrefix}-relation-toolbar-map-${mapOpen ? 'open' : 'default'}`}
            onClick={() => _setMapOpen(!mapOpen)}
            type='fa-map-o'/>
        </Tooltip>
        <div className={`${currentPrefix}-relation-toolbar-line`}/>
        <Tooltip
          offsetTop={2}
          title={FormatMessage.string({id: 'workbench.displayMode', defaultMessage: '显示模式'})}
          force
          placement='top'>
          <Icon
            ref={displayIconRef}
            className={`${currentPrefix}-relation-toolbar-displaymode ${displayMenuOpen ? 'open' : ''}`}
            onClick={() => setDisplayMenuOpen(pre => !pre)}
            type='fa-eye'/>
        </Tooltip>
      </div>
      {sliderOpen && <div ref={sliderRef} className={`${currentPrefix}-relation-toolbar-slider`}>
        <Slider onChange={sliderChange} value={numeral(scaleNumber).multiply(50).value()}/>
      </div>}
      {displayMenuOpen && <div ref={displayMenuRef} className={`${currentPrefix}-relation-toolbar-displaymenu`}>
        <div className={`${currentPrefix}-relation-toolbar-displaymenu-title`}>
          <FormatMessage id='workbench.displayMode' defaultMessage='显示模式'/>
        </div>
        {getDisplayOptions().map(opt => (
          <div
            key={opt.key}
            className={`${currentPrefix}-relation-toolbar-displaymenu-item ${opt.key === (displayMode || 'all') ? 'active' : ''}`}
            onClick={() => {
              onDisplayModeChange && onDisplayModeChange(opt.key);
              setDisplayMenuOpen(false);
            }}
          >
            {opt.label}
          </div>
        ))}
      </div>}
    </div>;
}));
