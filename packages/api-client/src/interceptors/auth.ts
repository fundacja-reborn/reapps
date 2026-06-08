import type { RequestConfig, RequestInterceptor } from '../types';

/**
 * Auth interceptor to add authorization headers
 */
export class AuthInterceptor implements RequestInterceptor {
  private currentUrl = '';

  setCurrentUrl(url: string): void {
    this.currentUrl = url;
  }

  async onRequest(config: RequestConfig): Promise<RequestConfig> {
    // Skip auth for specific endpoints
    if (config.skipAuth) {
      return config;
    }

    // Skip auth for auth endpoints
    const authEndpoints = ['/auth/login', '/auth/register', '/auth/logout', '/auth/verify', '/auth/refresh'];
    const isAuthEndpoint = authEndpoints.some(endpoint => 
      this.currentUrl?.includes(endpoint)
    );

    if (isAuthEndpoint) {
      return config;
    }

    // Get token from localStorage in browser environment
    if (typeof window !== 'undefined' && window.localStorage) {
      const accessToken = localStorage.getItem('access_token');
      
      if (accessToken) {
        // Add Authorization header
        config.headers = {
          ...config.headers,
          'Authorization': `Bearer ${accessToken}`
        };
      }
    }

    return config;
  }
}
