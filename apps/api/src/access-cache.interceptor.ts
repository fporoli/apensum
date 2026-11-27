import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { tap, type Observable } from 'rxjs';
import { forgetAccess } from './access';

/**
 * The controllers whose writes change who may do what (roles and their permissions, memberships and invitations,
 * modules, licences, operators, a new account, an import): after any of their non-GET requests the cached roles and
 * permissions are forgotten (access.ts `cachedAccess`; whatever else changes them is right after ACCESS_TTL_MS).
 */
export const ACCESS_WRITERS = new Set(['OrgsController', 'OrgRolesController', 'RolesController', 'OperatorController', 'AuthController', 'SetupController', 'ImportExportController']);

@Injectable()
export class AccessCacheInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const method = context.getType() === 'http' ? context.switchToHttp().getRequest<{ method?: string }>()?.method : undefined;
    if (!method || method === 'GET' || !ACCESS_WRITERS.has(context.getClass().name)) return next.handle();
    return next.handle().pipe(tap({ next: () => forgetAccess(), error: () => forgetAccess() }));
  }
}
