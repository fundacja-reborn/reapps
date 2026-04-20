/**
 * Authentication middleware for API routes
 * Framework-agnostic implementation
 */

import { createLogger } from '@reborn/utils';
import type { AuthUser } from '../types';

const logger = createLogger('AuthMiddleware');

export interface ApiRequest {
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string>;
  [key: string]: any;
}

export interface ApiResponse {
  status: (code: number) => ApiResponse;
  json: (data: any) => void;
  setHeader: (name: string, value: string) => ApiResponse;
}

export interface ApiContext {
  request: ApiRequest;
  response: ApiResponse;
  user?: AuthUser;
  userId?: string;
}

export interface AuthMiddlewareOptions {
  verifyToken: (token: string) => Promise<{ userId: string } | null>;
  getUserById?: (userId: string) => Promise<AuthUser | null>;
  tokenHeader?: string;
  cookieName?: string;
  publicPaths?: string[];
  onUnauthorized?: (context: ApiContext) => void;
}

/**
 * Extract token from request
 */
function extractToken(
  request: ApiRequest,
  tokenHeader: string,
  cookieName?: string
): string | null {
  // Check Authorization header
  const authHeader = request.headers[tokenHeader.toLowerCase()];
  if (authHeader) {
    const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (headerValue?.startsWith('Bearer ')) {
      return headerValue.slice(7);
    }
  }

  // Check cookie
  if (cookieName && request.cookies) {
    return request.cookies[cookieName] || null;
  }

  return null;
}

/**
 * Create authentication middleware for API routes
 */
export function createAuthMiddleware(options: AuthMiddlewareOptions) {
  const {
    verifyToken,
    getUserById,
    tokenHeader = 'Authorization',
    cookieName = 'auth-token',
    publicPaths = [],
    onUnauthorized
  } = options;

  return async function authMiddleware(
    context: ApiContext,
    next: () => Promise<void>
  ): Promise<void> {
    const { request, response } = context;
    const path = request.url || request.path || '';

    // Check if path is public
    const isPublicPath = publicPaths.some(publicPath => 
      path.includes(publicPath)
    );

    if (isPublicPath) {
      return next();
    }

    try {
      // Extract token
      const token = extractToken(request, tokenHeader, cookieName);

      if (!token) {
        logger.debug('No authentication token found');
        
        if (onUnauthorized) {
          onUnauthorized(context);
        }
        
        response.status(401).json({
          success: false,
          error: 'Authentication required'
        });
        return;
      }

      // Verify token
      const tokenData = await verifyToken(token);

      if (!tokenData) {
        logger.debug('Invalid authentication token');
        
        if (onUnauthorized) {
          onUnauthorized(context);
        }
        
        response.status(401).json({
          success: false,
          error: 'Invalid authentication token'
        });
        return;
      }

      // Attach user ID to context
      context.userId = tokenData.userId;

      // Optionally fetch full user data
      if (getUserById) {
        const user = await getUserById(tokenData.userId);
        if (user) {
          context.user = user;
        }
      }

      // Continue to next middleware
      await next();
    } catch (error) {
      logger.error('Auth middleware error:', error);
      
      response.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  };
}

/**
 * Create CORS middleware for API routes
 */
export interface CorsOptions {
  origin?: string | string[] | ((origin: string) => boolean);
  credentials?: boolean;
  methods?: string[];
  headers?: string[];
  maxAge?: number;
}

export function createCorsMiddleware(options: CorsOptions = {}) {
  const {
    origin = '*',
    credentials = true,
    methods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    headers = ['Content-Type', 'Authorization'],
    maxAge = 86400
  } = options;

  return async function corsMiddleware(
    context: ApiContext,
    next: () => Promise<void>
  ): Promise<void> {
    const { request, response } = context;
    const requestOrigin = request.headers.origin as string;

    // Determine allowed origin
    let allowedOrigin = '*';
    if (typeof origin === 'string') {
      allowedOrigin = origin;
    } else if (Array.isArray(origin)) {
      if (origin.includes(requestOrigin)) {
        allowedOrigin = requestOrigin;
      }
    } else if (typeof origin === 'function') {
      if (origin(requestOrigin)) {
        allowedOrigin = requestOrigin;
      }
    }

    // Set CORS headers
    response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    
    if (credentials) {
      response.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    
    response.setHeader('Access-Control-Allow-Methods', methods.join(', '));
    response.setHeader('Access-Control-Allow-Headers', headers.join(', '));
    response.setHeader('Access-Control-Max-Age', String(maxAge));

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      response.status(200).json({});
      return;
    }

    await next();
  };
}

/**
 * Rate limiting middleware
 */
export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  message?: string;
  keyGenerator?: (context: ApiContext) => string;
  store?: RateLimitStore;
}

export interface RateLimitStore {
  increment(key: string): Promise<number>;
  reset(key: string): Promise<void>;
}

// Simple in-memory rate limit store
export class MemoryRateLimitStore implements RateLimitStore {
  private requests = new Map<string, { count: number; resetAt: number }>();

  async increment(key: string): Promise<number> {
    const now = Date.now();
    const record = this.requests.get(key);

    if (!record || record.resetAt < now) {
      this.requests.set(key, {
        count: 1,
        resetAt: now + 60000 // 1 minute window
      });
      return 1;
    }

    record.count++;
    return record.count;
  }

  async reset(key: string): Promise<void> {
    this.requests.delete(key);
  }

  // Cleanup old entries periodically
  cleanup() {
    const now = Date.now();
    for (const [key, record] of this.requests.entries()) {
      if (record.resetAt < now) {
        this.requests.delete(key);
      }
    }
  }
}

export function createRateLimitMiddleware(options: RateLimitOptions = {}) {
  const {
    windowMs = 60000, // 1 minute
    max = 100,
    message = 'Too many requests',
    keyGenerator = (context) => context.userId || context.request.ip || 'anonymous',
    store = new MemoryRateLimitStore()
  } = options;

  // Cleanup store periodically
  if (store instanceof MemoryRateLimitStore) {
    setInterval(() => store.cleanup(), windowMs);
  }

  return async function rateLimitMiddleware(
    context: ApiContext,
    next: () => Promise<void>
  ): Promise<void> {
    const key = keyGenerator(context);
    const count = await store.increment(key);

    if (count > max) {
      context.response.status(429).json({
        success: false,
        error: message
      });
      return;
    }

    await next();
  };
}

/**
 * Combine multiple middleware functions
 */
export function combineMiddleware(
  ...middlewares: Array<(context: ApiContext, next: () => Promise<void>) => Promise<void>>
) {
  return async function combinedMiddleware(
    context: ApiContext,
    finalNext: () => Promise<void>
  ): Promise<void> {
    let index = 0;

    async function next(): Promise<void> {
      if (index >= middlewares.length) {
        return finalNext();
      }

      const middleware = middlewares[index++];
      await middleware(context, next);
    }

    await next();
  };
}
