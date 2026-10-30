import { Graph } from '@antv/x6';

Graph.registerEdge('erdRelation-img', {
  inherit: 'edge',
  router: {
    name: 'manhattan',
    args: {
      excludeShapes: ['group-img'],
    },
  },
  /*connector: {
    name: 'jumpover',
    args: {
      type: 'cubic',
    },
  },*/
  zIndex: 2,
  defaultLabel: {
    markup: [
      {
        tagName: 'rect',
        selector: 'body',
      },
      {
        tagName: 'text',
        selector: 'label',
      },
    ],
    attrs: {
      label: {
        fill: '#595959',
        fontSize: 11,
        textAnchor: 'middle',
        textVerticalAnchor: 'middle',
      },
      body: {
        ref: 'label',
        fill: '#ffffff',
        stroke: '#d9d9d9',
        strokeWidth: 1,
        rx: 3,
        ry: 3,
        refWidth: '100%',
        refHeight: '100%',
        refX: -4,
        refY: -2,
        refWidthPadding: 8,
        refHeightPadding: 4,
      },
    },
    position: {
      distance: 0.5,
    },
  },
  propHooks(metadata) {
    const { relation, fillColor, ...others } = metadata;
    if (relation) {
      return {
        ...metadata,
        attrs: {
          line: {
            stroke: fillColor,
            strokeDasharray: metadata?.attrs?.line?.strokeDasharray,
            sourceMarker: {
              fillColor,
              relation: relation.split(':')[0],
            },
            targetMarker: {
              fillColor,
              relation: relation.split(':')[1],
            },
          },
        },
      };
    }
    return others;
  },
  attrs: {
    line: {
      cursor: 'default',
      strokeWidth: 1,
      stroke: '#ACDAFC',
      sourceMarker: {
        name: 'relation',
      },
      targetMarker: {
        name: 'relation',
      },
    },
  },
});
