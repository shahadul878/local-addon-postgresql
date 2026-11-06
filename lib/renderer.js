'use strict';

const { createApi } = require('./ui/api');
const { createPostgresPanel } = require('./ui/PostgresPanel');

const TOOLS_PATH = '/postgresql';

/**
 * Renderer entry point. Adds a "PostgreSQL" tab to each site's Tools section.
 * Local instantiates this with `new`, so it must be a regular function.
 */
module.exports = function PostgresAddonRenderer(context) {
  const { React, hooks, electron } = context;
  const api = createApi(electron.ipcRenderer);
  const PostgresPanel = createPostgresPanel(React, {
    api,
    clipboard: electron.clipboard,
    confirm: (message) => window.confirm(message),
  });

  hooks.addFilter('siteInfoToolsItem', (items, { routeChildrenProps } = {}) => {
    const site = routeChildrenProps && routeChildrenProps.site;
    if (!site) {
      return items;
    }
    return [
      ...items,
      {
        path: TOOLS_PATH,
        menuItem: 'PostgreSQL',
        render: () => React.createElement(PostgresPanel, { key: site.id, site }),
      },
    ];
  });
};
