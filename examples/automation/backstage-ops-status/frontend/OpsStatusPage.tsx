import React, { useEffect, useState } from 'react';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/frontend-plugin-api';
import { parseSnapshot, type Snapshot } from '@internal/plugin-ops-status-common';

export function OpsStatusPage({ serviceId }: { serviceId: string }) {
  const discovery = useApi(discoveryApiRef);
  const client = useApi(fetchApiRef);
  const [state, setState] = useState<{ snapshot?: Snapshot; error?: string }>({});
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({});
    const timeout = setTimeout(() => controller.abort(), 5000);
    (async () => {
      const base = await discovery.getBaseUrl('ops-status');
      const response = await client.fetch(
        `${base}/snapshots/${encodeURIComponent(serviceId)}`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error(`Status request failed: ${response.status}`);
      const snapshot = parseSnapshot(await response.json());
      if (active) setState({ snapshot });
    })().catch(error => {
      if (active) setState({ error: error instanceof Error ? error.message : 'Request failed' });
    }).finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [discovery, client, serviceId]);
  if (state.error) return <p role="alert">{state.error}</p>;
  if (!state.snapshot) return <p>Loading operations status</p>;
  return <section>
    <h1>{state.snapshot.serviceId}</h1>
    <p>{state.snapshot.status} / {state.snapshot.environment}</p>
    <p>Source: {state.snapshot.source}; observed: {state.snapshot.observedAt}</p>
  </section>;
}
