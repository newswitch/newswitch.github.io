export type Snapshot = {
  serviceId: string;
  environment: 'staging';
  status: 'ready' | 'degraded';
  source: 'fixture';
  observedAt: string;
};

export function parseSnapshot(value: unknown): Snapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid snapshot response');
  }
  const data = value as Record<string, unknown>;
  if (typeof data.serviceId !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(data.serviceId)
    || data.environment !== 'staging' || data.source !== 'fixture'
    || (data.status !== 'ready' && data.status !== 'degraded')
    || typeof data.observedAt !== 'string' || Number.isNaN(Date.parse(data.observedAt))) {
    throw new Error('Invalid snapshot response');
  }
  return {
    serviceId: data.serviceId,
    environment: data.environment,
    status: data.status,
    source: data.source,
    observedAt: data.observedAt,
  };
}
