// Shared standard-content sync entry, extracted verbatim from the standard
// field editor (standardfield/index.js) so other maintenance UIs reuse the
// exact same propagation path for model fields bound via refStandard.

import {getAllTabData, replaceDataByTabId} from './cache';
import {notify} from './subscribe';

const calcChangeFieldData = (changeFields) => {
  const fullChange = [];
  changeFields.forEach((c) => {
    const index = fullChange.findIndex(f => f.id === c.id);
    if (index < 0) {
      fullChange.push({...c});
    } else {
      fullChange[index] = {
        ...fullChange[index],
        ...c,
      };
    }
  });
  return fullChange;
};

const updateFields = (data = [], update = []) => {
  const updateData = [];
  const newData = data.map((d) => {
    return {
      ...d,
      fields: (d.fields || []).map((f) => {
        if (f.refStandard) {
          const currentStandard = update.find(s => s.id === f.refStandard);
          if (currentStandard) {
            updateData.push(d.id);
            return {
              ...f,
              ...currentStandard,
              id: f.id,
            };
          }
          return f;
        }
        return f;
      }),
    };
  });
  return {
    updateData: [...new Set(updateData)],
    data: newData,
  };
};

const updateTabData = (needUpdateFields) => {
  const allTab = getAllTabData();
  Object.keys(allTab).map(t => ({tabKey: t, tabData: allTab[t]})).forEach((t) => {
    if (t.tabData.type === 'entity' || t.tabData.type === 'view') {
      const {data: [d], updateData} = updateFields([t.tabData.data], needUpdateFields);
      if (updateData.includes(t.tabData.key)) {
        replaceDataByTabId(t.tabKey, {
          ...t.tabData,
          data: d,
        });
        notify('tabDataChange', {id: t.tabData.key, d});
      }
    }
  });
};

// ADR-006 "apply preview naming": write the generated code and primary name
// into an existing standard, then propagate to every model field referencing
// it through the same content-sync path above. The original safety rules are
// kept: library-wide standard-code uniqueness, per-table defKey uniqueness on
// affected entities/views, and standard / entity ids and constraints are
// never recreated. Rejections are atomic (nothing is returned to commit).
const previewNamingUpdate = ({dataSource, group, field, defKey, defName}) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(defKey || '')) return {error: 'invalidFullName'};
  const normalizedKey = String(defKey).normalize('NFKC').trim().toLocaleLowerCase();
  const groups = dataSource.standardFields || [];
  const duplicateStandard = groups.some(g => (g.fields || []).some(f => f.id !== field.id
    && String(f.defKey || '').normalize('NFKC').trim().toLocaleLowerCase() === normalizedKey));
  if (duplicateStandard) return {error: 'duplicateField'};
  const tabTables = Object.values(getAllTabData())
    .filter(tab => tab.type === 'entity' || tab.type === 'view').map(tab => tab.data);
  const normalize = value => String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
  const tableConflict = [...(dataSource.entities || []), ...(dataSource.views || []), ...tabTables]
    .some((table) => {
      const fields = table.fields || [];
      if (!fields.some(f => f.refStandard === field.id)) return false;
      const keys = fields.map(f => normalize(f.refStandard === field.id ? defKey : f.defKey));
      return keys.filter(key => key === normalizedKey).length > 1;
    });
  if (tableConflict) return {error: 'applyNamingConflict'};
  const change = {id: field.id, defKey, defName};
  return {
    change,
    dataSource: {
      ...dataSource,
      entities: updateFields(dataSource.entities || [], [change]).data,
      views: updateFields(dataSource.views || [], [change]).data,
      standardFields: groups.map(g => (g.id !== group.id ? g : {
        ...g,
        fields: (g.fields || []).map(f => (f.id !== field.id ? f : {...f, ...change})),
      })),
    },
  };
};

export {
  calcChangeFieldData,
  updateFields,
  updateTabData,
  previewNamingUpdate,
};
