import React, {forwardRef, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import ReactDOM from 'react-dom';
import FormatMessage from '../formatmessage';
import {StandardFieldLibraryContext} from '../../lib/context';
import {
  searchRecommendations, matchWordRoots, composeWordRoots, fieldTypeLabel,
} from '../../lib/field_recommendation';
import './style/index.less';

const message = key => FormatMessage.string({id: `fieldRecommendation.${key}`});

export default forwardRef(({
  value, name, row, recommendation, onChange, onBlur, onKeyDown,
}, ref) => {
  const anchor = useRef(null);
  const openLibrary = useContext(StandardFieldLibraryContext);
  const panel = useRef(null);
  const composing = useRef(false);
  const instanceId = useMemo(() => Math.uuid(), []);
  const [snapshot, setSnapshot] = useState(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({});
  const [active, setActive] = useState(-1);
  const [limits, setLimits] = useState({standard: 40, similar: 40, roots: 40});
  const [rootDraft, setRootDraft] = useState({selected: [], remaining: '', candidates: []});
  const {settings} = recommendation;
  const close = () => { setVisible(false); setSnapshot(null); };
  const open = () => {
    const next = recommendation.getSnapshot();
    setSnapshot(next);
    setRootDraft(matchWordRoots(value, name, next.index.roots));
    setActive(-1);
    setLimits({standard: 40, similar: 40, roots: 40});
    setVisible(true);
  };
  useLayoutEffect(() => {
    if (visible) setSnapshot(recommendation.getSnapshot());
  }, [recommendation]);
  useLayoutEffect(() => {
    if (visible && snapshot) {
      setRootDraft(matchWordRoots(value, name, snapshot.index.roots));
      setActive(-1);
      setLimits({standard: 40, similar: 40, roots: 40});
    }
  }, [value, snapshot?.index.roots]);
  useEffect(() => {
    if (!visible) return undefined;
    const locate = () => {
      if (!anchor.current || !anchor.current.getClientRects().length) {
        close();
        return;
      }
      const rect = anchor.current.getBoundingClientRect();
      const width = Math.min(660, window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const upward = below < 280 && above > below;
      if (Math.max(above, below) < 40) { close(); return; }
      setPosition({
        width,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        ...(upward ? {bottom: window.innerHeight - rect.top + 4} : {top: rect.bottom + 4}),
        maxHeight: Math.max(0, Math.min(510, upward ? above : below)),
      });
    };
    const outside = (event) => {
      if (!anchor.current?.contains(event.target) && !panel.current?.contains(event.target)) {
        close();
      }
    };
    const scroll = (event) => {
      if (!panel.current?.contains(event.target) && !anchor.current?.contains(event.target)) {
        close();
      }
    };
    const observer = new MutationObserver(() => {
      if (!anchor.current?.getClientRects().length) close();
    });
    for (let parent = anchor.current?.parentElement; parent; parent = parent.parentElement) {
      observer.observe(parent, {attributes: true, attributeFilter: ['class', 'style']});
    }
    locate();
    document.addEventListener('mousedown', outside, true);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', locate);
    return () => {
      observer.disconnect();
      document.removeEventListener('mousedown', outside, true);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', locate);
    };
  }, [visible]);
  useEffect(() => {
    if (active >= 0) {
 panel.current?.querySelector('.chiner-field-recommendation-candidate[aria-selected="true"]')
      ?.scrollIntoView({block: 'nearest'});
}
  }, [active]);
  const results = visible && snapshot ? searchRecommendations(snapshot.index, value, name, row.id)
    : {standard: [], similar: []};
  const roots = visible && snapshot ? snapshot.index.roots.filter(root => !rootDraft.remaining
    || rootDraft.candidates.some(candidate => candidate.id === root.id)) : [];
  const standard = settings.standard ? results.standard.slice(0, limits.standard) : [];
  const similar = settings.similar ? results.similar.slice(0, limits.similar) : [];
  const rootItems = settings.roots ? roots.slice(0, limits.roots) : [];
  const candidates = standard.concat(similar, rootItems.map(root => ({key: `root:${root.id}`, root})));
  const select = (candidate) => {
    if (candidate.root) {
      setRootDraft({selected: rootDraft.selected.concat(candidate.root), remaining: '', candidates: []});
      setActive(-1);
    } else if (recommendation.apply(row.id, candidate)) close();
  };
  const keyDown = (event) => {
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.keyCode === 85) {
      event.preventDefault();
      const current = value === undefined || value === null ? '' : String(value);
      const upper = current.toLocaleUpperCase();
      onChange({target: {value: upper === current ? current.toLocaleLowerCase() : upper}});
      onKeyDown && onKeyDown(event);
    } else if (visible && candidates.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      event.stopPropagation();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      if (candidates.length) {
        setActive((index) => {
          if (index < 0) return direction === 1 ? 0 : candidates.length - 1;
          return (index + direction + candidates.length) % candidates.length;
        });
      }
    } else if (visible && event.key === 'Enter' && active >= 0 && candidates[active]) {
      event.preventDefault();
      event.stopPropagation();
      select(candidates[active]);
    } else if (visible && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else {
      if (event.key === 'Tab') close();
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') close();
      onKeyDown && onKeyDown(event);
    }
  };
  const candidateButton = (candidate, content) => <button
    type='button'
    role='option'
    key={candidate.key}
    data-candidate-key={candidate.key}
    aria-selected={candidates[active]?.key === candidate.key}
    className='chiner-field-recommendation-candidate'
    onMouseDown={event => event.preventDefault()}
    onClick={() => select(candidate)}
    title={candidate.field ? `${candidate.entityKey || candidate.group || ''}\n${candidate.field.defKey}\n${candidate.field.defName || ''}\n${fieldTypeLabel(candidate.field, snapshot.source)}` : ''}
  >{content}</button>;
  const loadMore = kind => (event) => {
    const element = event.currentTarget;
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 40) {
      setLimits(previous => ({...previous, [kind]: previous[kind] + 40}));
    }
  };
  const combination = composeWordRoots(rootDraft.selected, settings);
  return <span ref={anchor} className='chiner-field-recommendation-input'>
    <input
      ref={ref}
      aria-label={name === 'defKey' ? message('codeInput') : message('nameInput')}
      value={value === undefined || value === null ? '' : value}
      autoComplete='off'
      onFocus={() => { if (!visible) open(); }}
      onClick={() => { if (!visible) open(); }}
      onChange={(event) => {
        onChange(event);
        if (!visible) open();
      }}
      onKeyDown={keyDown}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; }}
      onBlur={(event) => {
        if (panel.current?.contains(event.relatedTarget)) return;
        const trimmed = name === 'defKey' ? event.target.value.replace(/\s/g, '') : event.target.value.trim();
        if (trimmed !== value) onChange({target: {value: trimmed}});
        onBlur && onBlur(event);
        close();
      }}
    />
    <button
      type='button'
      aria-label={message('open')}
      onMouseDown={event => event.preventDefault()}
      onClick={() => (visible ? close() : open())}>⌄</button>
    {visible && snapshot && ReactDOM.createPortal(<div
      ref={panel}
      role='dialog'
      aria-label={message('title')}
      className='chiner-field-recommendation-panel'
      style={position}
      onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') close(); }}
    >
      <div className='chiner-field-recommendation-heading'>
        <strong>{message('title')}</strong>
        {openLibrary && <button type='button' onMouseDown={event => event.preventDefault()}
          onClick={() => { close(); openLibrary(); }}>
          {message('openLibrary')} <span aria-hidden='true'>↗</span>
        </button>}
      </div>
      <div className='chiner-field-recommendation-top'>
        {settings.standard && <section>
          <h4>{message('standard')} <small>{results.standard.length}</small></h4>
          <div role='listbox' aria-label={message('standard')} className='chiner-field-recommendation-list' onScroll={loadMore('standard')}>
            {!standard.length && <p className='chiner-field-recommendation-empty'>{message('emptyStandard')}</p>}
            {standard.map(candidate => candidateButton(candidate, <>
              <small className='chiner-field-recommendation-group'>{candidate.group}</small>
              <span>{candidate.field.defKey}</span><span>{candidate.field.defName}</span>
              <small>{fieldTypeLabel(candidate.field, snapshot.source)}</small>
            </>))}
          </div>
        </section>}
        {settings.roots && <section>
          <h4>{message('roots')}</h4>
          <div role='listbox' aria-label={message('roots')} className='chiner-field-recommendation-list' onScroll={loadMore('roots')}>
            {!rootItems.length && <p className='chiner-field-recommendation-empty'>{message('emptyRoots')}</p>}
            {rootItems.map(root => candidateButton({key: `root:${root.id}`, root},
              <><span>{root.defKey}</span><span>{root.defName}</span></>))}
          </div>
          <div className='chiner-field-recommendation-combination'>
            <div className='chiner-field-recommendation-tags'>{rootDraft.selected.map((root, i) =>
              <span key={`${root.id}:${i}`}>{root.defName}</span>)}</div>
            {rootDraft.remaining && <p className='chiner-field-recommendation-warning'>
              {message('unmatched')}: {rootDraft.remaining}
            </p>}
            <p>{message('suggestion')}: <strong>{combination.field.defKey || '—'}</strong>
              {combination.field.defName && <span> [{combination.field.defName}]</span>}</p>
            <div className='chiner-field-recommendation-actions'>
              <button
                type='button'
                disabled={!rootDraft.selected.length || !!rootDraft.remaining}
                onMouseDown={event => event.preventDefault()}
                onClick={() => select(combination)}>{message('use')}</button>
              <button
                type='button'
                disabled={!rootDraft.selected.length}
                onMouseDown={event => event.preventDefault()}
                onClick={() => setRootDraft({...rootDraft, selected: rootDraft.selected.slice(0, -1)})}>{message('removeLast')}</button>
              <button
                type='button'
                onMouseDown={event => event.preventDefault()}
                onClick={() => setRootDraft({selected: [], remaining: '', candidates: []})}>{message('reset')}</button>
            </div>
            <div className='chiner-field-recommendation-style'>
              <label htmlFor={`${instanceId}-style`}>{message('style')} <select
                id={`${instanceId}-style`}
                value={settings.style}
                onChange={event => recommendation.setSettings({style: event.target.value})}>
                <option value='snake'>{message('snake')}</option><option value='camel'>{message('camel')}</option>
              </select></label>
              <label htmlFor={`${instanceId}-case`}>{message('case')} <select
                id={`${instanceId}-case`}
                value={settings.case}
                disabled={settings.style === 'camel'}
                onChange={event => recommendation.setSettings({case: event.target.value})}>
                <option value='lower'>{message('lower')}</option><option value='upper'>{message('upper')}</option>
                <option value='mixed'>{message('mixed')}</option>
              </select></label>
            </div>
          </div>
        </section>}
      </div>
      {settings.similar && <section>
        <h4>{message('similar')} <small>{results.similar.length}</small></h4>
        <div role='listbox' aria-label={message('similar')} className='chiner-field-recommendation-list similar' onScroll={loadMore('similar')}>
          {!similar.length && <p className='chiner-field-recommendation-empty'>
            {message(value ? 'emptySimilar' : 'typeToSearch')}</p>}
          {similar.map(candidate => candidateButton(candidate, <>
            <span>{candidate.entityKey}<small>{candidate.entityName}</small></span>
            <span>{candidate.field.defKey}</span><span>{candidate.field.defName}</span>
            <small>{fieldTypeLabel(candidate.field, snapshot.source)}</small>
          </>))}
        </div>
      </section>}
    </div>, document.body)}
  </span>;
});
