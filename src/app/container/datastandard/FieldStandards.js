import React, {useMemo, useState} from 'react';
import {Button, Checkbox, FormatMessage, Select, SearchInput} from 'components';
import {FixedSizeList} from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import {getPrefix} from '../../../lib/prefixUtil';

const label = key => FormatMessage.string({id: `dataStandard.${key}`});
const normalized = value => (value === undefined || value === null ? '' : String(value))
  .normalize('NFKC').trim().toLocaleLowerCase();

// Field-standard main page: searchable, scope/frequent filtered list with
// per-field metadata editing, combination editing and link release. Only
// library metadata is touched here; entity fields are never synchronized.
export default ({prefix, dataSource, updateDataSource, openMetaEdit, openCombination}) => {
  const currentPrefix = getPrefix(prefix);
  const [filter, setFilter] = useState('');
  const [scope, setScope] = useState('');
  const [frequentOnly, setFrequentOnly] = useState(false);
  const groups = dataSource.standardFields || [];
  const roots = dataSource.profile?.fieldRecommendation?.wordRoots || [];
  const rows = useMemo(() => {
    const query = normalized(filter);
    return groups.reduce((items, group) => items.concat((group.fields || [])
      .map(field => ({group, field}))
      // 旧标准缺少 scope 时按项目范围处理
      .filter(({field}) => (scope ? (field.standardMeta?.scope || 'project') === scope : true))
      .filter(({field}) => (frequentOnly ? !!field.standardMeta?.frequent : true))
      .filter(({field}) => (!query || [field.defName, field.defKey,
        ...(field.standardMeta?.aliases || [])]
        .some(value => normalized(value).includes(query))))), []);
  }, [groups, filter, scope, frequentOnly]);
  const releaseRefs = (field, group) => {
    // 解除组合关联只移除词元引用，已确认代码与名称保持不变。
    if (!field.standardMeta?.wordRootRefs?.length) return;
    updateDataSource({
      ...dataSource,
      standardFields: groups.map(item => (item.id !== group.id ? item : {
        ...item,
        fields: (item.fields || []).map(f => (f.id !== field.id ? f : {
          ...f,
          standardMeta: (() => {
            const next = {...f.standardMeta};
            delete next.wordRootRefs;
            delete next.namingForm;
            return Object.keys(next).length ? next : undefined;
          })(),
        })),
      })),
    });
  };
  const scopeName = value => label(`scope_${value || 'project'}`);
  const refsText = (field) => {
    const refs = field.standardMeta?.wordRootRefs || [];
    if (!refs.length) return '';
    return refs.map(id => roots.find(root => root.id === id))
      .filter(Boolean).map(root => root.defKey).join(' + ');
  };
  const Row = ({index, style}) => {
    const {group, field} = rows[index];
    return <div style={style} className={`${currentPrefix}-data-standard-field-row`}>
      <span className={`${currentPrefix}-data-standard-field-group`}>{group.defName || group.defKey}</span>
      <span className={`${currentPrefix}-data-standard-field-name`}>{field.defName}</span>
      <span className={`${currentPrefix}-data-standard-field-key`}>{field.defKey}</span>
      <span className={`${currentPrefix}-data-standard-field-scope`}>
        {scopeName(field.standardMeta?.scope)}
        {field.standardMeta?.industry ? `(${field.standardMeta.industry})` : ''}
      </span>
      <span className={`${currentPrefix}-data-standard-field-aliases`}>
        {(field.standardMeta?.aliases || []).join(', ')}
      </span>
      <span className={`${currentPrefix}-data-standard-field-refs`}>{refsText(field)}</span>
      <span className={`${currentPrefix}-data-standard-field-frequent`}>
        {field.standardMeta?.frequent ? label('frequentLabel') : ''}
      </span>
      <span className={`${currentPrefix}-data-standard-field-actions`}>
        <Button onClick={() => openMetaEdit(field, group)}>{label('editFieldMeta')}</Button>
        <Button onClick={() => openCombination(field, group)}>{label('editCombination')}</Button>
        {!!field.standardMeta?.wordRootRefs?.length
          && <Button onClick={() => releaseRefs(field, group)}>{label('releaseRefs')}</Button>}
      </span>
    </div>;
  };
  return <React.Fragment>
    <div className={`${currentPrefix}-data-standard-field-filters`}>
      <SearchInput
        placeholder={label('fieldsSearch')}
        onChange={e => setFilter(e.target.value)}/>
      <Select
        style={{width: 120}}
        value={scope}
        onChange={e => setScope(e.target.value)}>
        {/* The project Select iterates child.props.value, so children must be
            one flat option array — never a fixed option beside a mapped array. */}
        {[
          <Select.Option key='all' value=''>{label('scopeAll')}</Select.Option>,
          ...['common', 'industry', 'project'].map(item => <Select.Option key={item} value={item}>
            {label(`scope_${item}`)}
          </Select.Option>),
        ]}
      </Select>
      <span>
        <Checkbox
          checked={frequentOnly}
          onChange={() => setFrequentOnly(previous => !previous)}/>
        {label('frequentOnly')}
      </span>
      <span className={`${currentPrefix}-data-standard-count`}>
        {`${rows.length} ${label('fieldCount')} / ${groups.length} ${label('groupCount')}`}
      </span>
    </div>
    {rows.length ? <div className={`${currentPrefix}-data-standard-list`}>
      <AutoSizer>
        {({height, width}) => <FixedSizeList
          height={height}
          width={width}
          itemCount={rows.length}
          itemSize={30}>
          {Row}
        </FixedSizeList>}
      </AutoSizer>
    </div> : <p className={`${currentPrefix}-data-standard-empty`}>{label('fieldsEmpty')}</p>}
  </React.Fragment>;
};
