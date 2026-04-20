/**
 * Authentication guard for route protection
 * Framework-agnostic implementation
 */

import { createLogger } from '@reborn/utils';
import type { SessionManager } from '../services/SessionManager';

const logger = createLogger('AuthGuard');

export interface AuthGuardOptions {
  sessionManager: SessionManager;
  loginPath?: string;
  publicPaths?: string[];
  requireE2E?: boolean;
  onUnauthorized?: () => void;
}

export interface RouteContext {
  path: string;
  redirect: (path: string) => void;
}

/**
 * Create an authentication guard for protecting routes
 */
export function createAuthGuard(options: AuthGuardOptions) {
  const {
    sessionManager,
    loginPath = '/login',
    publicPaths = ['/login', '/register'],
    requireE2E = false,
    onUnauthorized
  } = options;

  return async function authGuard(context: RouteContext): Promise<boolean> {
    const { path, redirect } = context;

    // Check if path is public
    if (publicPaths.some(publicPath => path.startsWith(publicPath))) {
      return true;
    }

    // Get current session
    const session = sessionManager.getCurrentSession();

    // Check if user is authenticated
    if (!session.isAuthenticated) {
      logger.debug(`Unauthenticated access to protected route: ${path}`);
      
      if (onUnauthorized) {
        onUnauthorized();
      }
      
      redirect(loginPath);
      return false;
    }

    // Check E2E requirement
    if (requireE2E && !session.hasE2E) {
      logger.warn(`E2E encryption required for route: ${path}`);
      
      if (onUnauthorized) {
        onUnauthorized();
      }
      
      redirect(loginPath);
      return false;
    }

    return true;
  };
}

/**
 * Create route matcher for complex path patterns
 */
export function createRouteMatcher(patterns: string[]) {
  return (path: string): boolean => {
    return patterns.some(pattern => {
      // Simple wildcard support
      if (pattern.includes('*')) {
        const regex = new RegExp(
          '^' + pattern.replace(/\*/g, '.*') + '$'
        );
        return regex.test(path);
      }
      
      // Exact match
      return path === pattern || path.startsWith(pattern);
    });
  };
}

/**
 * Combine multiple guards
 */
export function combineGuards(...guards: Array<(context: RouteContext) => Promise<boolean>>) {
  return async function combinedGuard(context: RouteContext): Promise<boolean> {
    for (const guard of guards) {
      const allowed = await guard(context);
      if (!allowed) {
        return false;
      }
    }
    return true;
  };
}

/**
 * Role-based access control guard
 */
export interface RoleGuardOptions {
  sessionManager: SessionManager;
  requiredRoles?: string[];
  requiredPermissions?: string[];
  onUnauthorized?: () => void;
}

export function createRoleGuard(options: RoleGuardOptions) {
  const {
    sessionManager,
    requiredRoles = [],
    requiredPermissions = [],
    onUnauthorized
  } = options;

  return async function roleGuard(context: RouteContext): Promise<boolean> {
    const session = sessionManager.getCurrentSession();
    
    if (!session.isAuthenticated || !session.user) {
      return false;
    }

    // Note: This is a placeholder implementation
    // In a real app, you'd check user.roles and user.permissions
    // For now, we'll just return true if authenticated
    
    // Example implementation:
    // const userRoles = session.user.roles || [];
    // const userPermissions = session.user.permissions || [];
    
    // const hasRequiredRole = requiredRoles.length === 0 || 
    //   requiredRoles.some(role => userRoles.includes(role));
    
    // const hasRequiredPermission = requiredPermissions.length === 0 ||
    //   requiredPermissions.some(perm => userPermissions.includes(perm));
    
    // if (!hasRequiredRole || !hasRequiredPermission) {
    //   if (onUnauthorized) {
    //     onUnauthorized();
    //   }
    //   return false;
    // }

    return true;
  };
}
