import React from 'react';
import { createFrontendPlugin, PageBlueprint } from '@backstage/frontend-plugin-api';

const statusPage = PageBlueprint.make({
  params: {
    path: '/ops-status',
    title: 'Operations status',
    loader: () => import('./OpsStatusPage').then(m => <m.OpsStatusPage serviceId="orders" />),
  },
});

export default createFrontendPlugin({
  pluginId: 'ops-status',
  info: { packageJson: () => import('../package.json') },
  extensions: [statusPage],
});
