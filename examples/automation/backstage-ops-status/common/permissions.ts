import { createPermission } from '@backstage/plugin-permission-common';

export const opsStatusReadPermission = createPermission({
  name: 'ops-status.read',
  attributes: { action: 'read' },
});

export { parseSnapshot } from './contract';
export type { Snapshot } from './contract';
