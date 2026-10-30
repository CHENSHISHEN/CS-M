import React, {useEffect, useMemo, useRef, useState} from 'react';
import ReactDOM from 'react-dom';
import {FormatMessage, openModal} from 'components';
import {getCache, setCache} from '../../lib/cache';
import {subscribeEvent, unSubscribeEvent, notify} from '../../lib/subscribe';
import {recommendationDefaults} from '../../lib/field_recommendation';
import WordRoots from './WordRoots';
import './style/index.less';

const eventName = 'fieldRecommendationSettings';
const read = (key) => {
  let stored;
  try { stored = getCache(key, true) || {}; } catch (error) { stored = {}; }
  const settings = {...recommendationDefaults};
  ['standard', 'similar', 'roots'].forEach((name) => {
    if (typeof stored[name] === 'boolean') settings[name] = stored[name];
  });
  if (['snake', 'camel'].includes(stored.style)) settings.style = stored.style;
  if (['upper', 'lower', 'mixed'].includes(stored.case)) settings.case = stored.case;
  return settings;
};

export const useRecommendationSettings = (projectId) => {
  const key = `fieldRecommendation:${projectId || 'new'}`;
  const id = useMemo(() => Math.uuid(), []);
  const [settings, setSettings] = useState(() => read(key));
  useEffect(() => {
    setSettings(read(key));
    subscribeEvent(eventName, (event) => {
      if (event.key === key) setSettings(event.settings);
    }, id);
    return () => unSubscribeEvent(eventName, id);
  }, [key]);
  const change = (patch) => {
    const next = {...read(key), ...patch};
    setCache(key, next);
    setSettings(next);
    notify(eventName, {key, settings: next});
  };
  return [settings, change];
};

export default ({settings, setSettings, getDataSource, updateDataSource}) => {
  const anchor = useRef(null);
  const popup = useRef(null);
  const instanceId = useMemo(() => Math.uuid(), []);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({});
  const label = key => FormatMessage.string({id: `fieldRecommendation.${key}`});
  useEffect(() => {
    if (!visible) return undefined;
    const rect = anchor.current.getBoundingClientRect();
    setPosition({
      top: rect.bottom + 5,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 196)),
    });
    const close = (event) => {
      if (!anchor.current?.contains(event.target) && !popup.current?.contains(event.target)) {
        setVisible(false);
      }
    };
    const resize = () => setVisible(false);
    const scroll = (event) => { if (!popup.current?.contains(event.target)) setVisible(false); };
    document.addEventListener('mousedown', close, true);
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('mousedown', close, true);
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [visible]);
  const manage = () => {
    setVisible(false);
    let modal;
    modal = openModal(<WordRoots
      getDataSource={getDataSource}
      updateDataSource={updateDataSource}
      onClose={() => modal.close()}
    />, {
      title: label('manageRoots'),
      bodyStyle: {width: '75%'},
      contentStyle: {maxHeight: '80vh'},
      // The editor owns save / guarded close; outer X, Escape and footer
      // buttons are disabled so drafts can never be dropped silently.
      closeable: false,
      buttons: [],
    });
  };
  return <details ref={anchor} open={visible} className='chiner-field-recommendation-settings'>
    <summary
      aria-expanded={visible ? 'true' : 'false'}
      aria-haspopup='true'
      onKeyDown={(event) => { if (event.key === 'Escape') setVisible(false); }}
      onClick={(event) => { event.preventDefault(); setVisible(!visible); }}>
      {label('title')}
      <i className={`fa fa-angle-down${visible ? ' is-open' : ''}`} aria-hidden='true'/>
    </summary>
    {visible && ReactDOM.createPortal(<div
      ref={popup}
      style={position}
      className='chiner-field-recommendation-options'
      onKeyDown={(event) => { if (event.key === 'Escape') setVisible(false); }}>
      {['standard', 'similar', 'roots'].map(key => <label key={key} htmlFor={`${instanceId}-${key}`}>
        <input
          id={`${instanceId}-${key}`}
          type='checkbox'
          aria-label={label(key)}
          checked={settings[key]}
          onChange={event => setSettings({[key]: event.target.checked})}/>{label(key)}
      </label>)}
      <button type='button' onClick={manage}>{label('manageRoots')}</button>
    </div>, document.body)}
  </details>;
};
