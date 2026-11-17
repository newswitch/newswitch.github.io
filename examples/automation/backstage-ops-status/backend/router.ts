import type { HttpAuthService, PermissionsService } from '@backstage/backend-plugin-api';
import { InputError, NotAllowedError, NotFoundError } from '@backstage/errors';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import { opsStatusReadPermission, type Snapshot } from '@internal/plugin-ops-status-common';
import Router from 'express-promise-router';
import { isServiceId } from './model';

type Options = {
  httpAuth: HttpAuthService;
  permissions: PermissionsService;
  readSnapshot: (id: string) => Promise<Snapshot | undefined>;
};

export function createRouter({ httpAuth, permissions, readSnapshot }: Options) {
  const router = Router();
  router.get('/snapshots/:serviceId', async (req, res) => {
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    const [decision] = await permissions.authorize(
      [{ permission: opsStatusReadPermission }],
      { credentials },
    );
    if (decision?.result !== AuthorizeResult.ALLOW) {
      throw new NotAllowedError('Not allowed to read operations status');
    }
    const id = req.params.serviceId;
    if (!isServiceId(id)) throw new InputError('Invalid service id');
    const snapshot = await readSnapshot(id);
    if (!snapshot) throw new NotFoundError('Service is not configured');
    res.json(snapshot);
  });
  return router;
}
