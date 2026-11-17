import type { UserInfoService } from '@backstage/backend-plugin-api';
import { AuthorizeResult, isPermission, type PolicyDecision } from '@backstage/plugin-permission-common';
import type { PermissionPolicy, PolicyQuery, PolicyQueryUser } from '@backstage/plugin-permission-node';
import { opsStatusReadPermission } from '@internal/plugin-ops-status-common';

// Isolated example policy. Merge its branch into an existing production policy.
export class CustomPolicy implements PermissionPolicy {
  constructor(private readonly userInfo: UserInfoService) {}

  async handle(request: PolicyQuery, user?: PolicyQueryUser): Promise<PolicyDecision> {
    if (!user || !isPermission(request.permission, opsStatusReadPermission)) {
      return { result: AuthorizeResult.DENY };
    }
    const info = await this.userInfo.getUserInfo(user.credentials);
    return {
      result: info.ownershipEntityRefs.includes('group:default/ops-readers')
        ? AuthorizeResult.ALLOW
        : AuthorizeResult.DENY,
    };
  }
}
