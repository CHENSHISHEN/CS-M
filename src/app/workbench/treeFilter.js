// 资源树本地筛选：只过滤传给 Menu 的呈现数据，不修改模型 JSON
// menus 结构与 main/index.js 的 simpleMenu/groupMenu 一致：
// {id, defKey, defName, type, children: [{id, defKey, defName, ...}]}
const matchText = (item, text) => {
  if (!text) {
    return true;
  }
  const key = `${item.defKey || ''}`.toLocaleLowerCase();
  const name = `${item.defName || ''}`.toLocaleLowerCase();
  const target = text.toLocaleLowerCase();
  return key.includes(target) || name.includes(target);
};

// 过滤顶层树：子项匹配则保留该组（组名自身匹配则保留全部子项）
export const filterTreeMenus = (menus, text) => {
  if (!text || !menus) {
    return menus || [];
  }
  return menus.map((menu) => {
    if (!menu.children) {
      return matchText(menu, text) ? menu : null;
    }
    if (matchText(menu, text)) {
      return menu;
    }
    const children = filterTreeMenus(menu.children, text);
    if (children.length === 0) {
      return null;
    }
    return {
      ...menu,
      children,
    };
  }).filter(m => !!m);
};

export default filterTreeMenus;
