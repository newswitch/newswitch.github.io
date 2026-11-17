import express from 'express';
import request from 'supertest';
import { AuthenticationError } from '@backstage/errors';
import { MiddlewareFactory } from '@backstage/backend-defaults/rootHttpRouter';
import { mockCredentials, mockServices } from '@backstage/backend-test-utils';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import { opsStatusReadPermission } from '@internal/plugin-ops-status-common';
import { createRouter } from './router';
import { readFixtureSnapshot } from './model';

describe('operations status router', () => {
  const credentials = mockCredentials.user();
  const httpAuth = mockServices.httpAuth.mock();
  const permissions = mockServices.permissions.mock();
  const readSnapshot = jest.fn(readFixtureSnapshot);
  const errors = MiddlewareFactory.create({
    logger: mockServices.logger.mock(),
    config: mockServices.rootConfig(),
  }).error();
  const app = express()
    .use('/api/ops-status', createRouter({ httpAuth, permissions, readSnapshot }))
    .use(errors);

  beforeEach(() => {
    jest.clearAllMocks();
    httpAuth.credentials.mockResolvedValue(credentials);
    permissions.authorize.mockResolvedValue([{ result: AuthorizeResult.ALLOW }]);
  });

  it('returns a declared fixture after authorization', async () => {
    const response = await request(app).get('/api/ops-status/snapshots/orders');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ serviceId: 'orders', source: 'fixture' });
    expect(permissions.authorize).toHaveBeenCalledWith(
      [{ permission: opsStatusReadPermission }], { credentials },
    );
    expect(httpAuth.credentials).toHaveBeenCalledWith(expect.anything(), { allow: ['user'] });
  });

  it('does not read data when denied', async () => {
    permissions.authorize.mockResolvedValue([{ result: AuthorizeResult.DENY }]);
    expect((await request(app).get('/api/ops-status/snapshots/orders')).status).toBe(403);
    expect(readSnapshot).not.toHaveBeenCalled();
  });

  it('fails closed when no decision is returned', async () => {
    permissions.authorize.mockResolvedValue([]);
    expect((await request(app).get('/api/ops-status/snapshots/orders')).status).toBe(403);
    expect(readSnapshot).not.toHaveBeenCalled();
  });

  it('does not authorize or read data without accepted credentials', async () => {
    httpAuth.credentials.mockRejectedValue(new AuthenticationError('Sign in required'));
    expect((await request(app).get('/api/ops-status/snapshots/orders')).status).toBe(401);
    expect(permissions.authorize).not.toHaveBeenCalled();
    expect(readSnapshot).not.toHaveBeenCalled();
  });

  it('rejects invalid identifiers', async () => {
    expect((await request(app).get('/api/ops-status/snapshots/bad_id')).status).toBe(400);
    expect(readSnapshot).not.toHaveBeenCalled();
  });

  it('does not invent a binding for an unknown identifier', async () => {
    expect((await request(app).get('/api/ops-status/snapshots/unknown-service')).status).toBe(404);
  });
});
