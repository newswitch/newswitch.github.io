import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { opsStatusReadPermission } from '@internal/plugin-ops-status-common';
import { createRouter } from './router';
import { readFixtureSnapshot } from './model';

export const opsStatusPlugin = createBackendPlugin({
  pluginId: 'ops-status',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        permissions: coreServices.permissions,
        permissionsRegistry: coreServices.permissionsRegistry,
      },
      async init({ httpRouter, httpAuth, permissions, permissionsRegistry }) {
        permissionsRegistry.addPermissions([opsStatusReadPermission]);
        httpRouter.use(createRouter({
          httpAuth, permissions, readSnapshot: readFixtureSnapshot,
        }));
      },
    });
  },
});
