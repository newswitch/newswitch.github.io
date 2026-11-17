import type { Snapshot } from '@internal/plugin-ops-status-common';

const fixtures: Readonly<Record<string, Snapshot>> = {
  orders: {
    serviceId: 'orders',
    environment: 'staging',
    status: 'ready',
    source: 'fixture',
    observedAt: '2026-11-16T00:00:00Z',
  },
};

export function isServiceId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(value);
}

export async function readFixtureSnapshot(
  serviceId: string,
): Promise<Snapshot | undefined> {
  if (!Object.prototype.hasOwnProperty.call(fixtures, serviceId)) return undefined;
  return { ...fixtures[serviceId] };
}
