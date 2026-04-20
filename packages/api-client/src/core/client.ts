import { createLogger } from '@reborn/utils';
import type {
  ApiClientConfig,
  ApiResponse,
  ApiError,
  RequestConfig,
  RequestInterceptor,
  ResponseInterceptor,
  QueuedRequest,
  SyncStatus,
  IdMapping,
  EntityType,
  OperationType
} from '../types';
import { AuthInterceptor } from '../interceptors/auth';
import { EncryptionInterceptor } from '../interceptors/encryption';
import { OfflineQueue } from '../utils/offline-queue';
import { IdResolver } from '../utils/id-resolver';
import { RetryManager } from '../utils/retry-manager';

const logger = createLogger('ApiClient');

/**
 * Universal API client with E2E encryption and offline support
 */
export class ApiClient {
  private config: Required<ApiClientConfig>;
  private requestInterceptors: RequestInterceptor[] = [];
  private responseInterceptors: ResponseInterceptor[] = [];
  private offlineQueue: OfflineQueue;
  private idResolver: IdResolver;
  private retryManager: RetryManager;
  private syncInProgress = false;
  private authInterceptor?: AuthInterceptor;
  private encryptionInterceptor?: EncryptionInterceptor;

  constructor(config: ApiClientConfig = {}) {
    // Initialize configuration with defaults
    this.config = {
      baseUrl: config.baseUrl || '/api',
      timeout: config.timeout || 30000,
      retries: config.retries || 3,
      retryDelay: config.retryDelay || 1000,
      headers: config.headers || {},
      onRequest: config.onRequest || ((c) => c),
      onResponse: config.onResponse || ((r) => r),
      onError: config.onError || (() => {})
    };

    // Initialize utilities
    this.offlineQueue = new OfflineQueue();
    this.idResolver = new IdResolver();
    this.retryManager = new RetryManager(this.config.retries, this.config.retryDelay);

    // Add default interceptors
    const authInterceptor = new AuthInterceptor();
    this.addRequestInterceptor(authInterceptor);
    const encryptionInterceptor = new EncryptionInterceptor();
    this.addRequestInterceptor(encryptionInterceptor);
    
    // Store references to interceptors for URL setting
    this.authInterceptor = authInterceptor;
    this.encryptionInterceptor = encryptionInterceptor;

    // Listen for online/offline events
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.syncOfflineQueue());
      window.addEventListener('offline', () => logger.info('Client went offline'));
    }
  }

  /**
   * Add request interceptor
   */
  addRequestInterceptor(interceptor: RequestInterceptor): void {
    this.requestInterceptors.push(interceptor);
  }

  /**
   * Add response interceptor
   */
  addResponseInterceptor(interceptor: ResponseInterceptor): void {
    this.responseInterceptors.push(interceptor);
  }

  /**
   * Main request method
   */
  async request<T>(
    url: string,
    config: RequestConfig = {}
  ): Promise<ApiResponse<T>> {
    // Build full URL
    const fullUrl = this.buildUrl(url);

    // Auto-generate Idempotency-Key for mutation requests (once per request lifecycle).
    // Stored in config.headers so retries reuse the same key.
    const method = (config.method || 'GET').toUpperCase();
    const configHeaders = config.headers as Record<string, string> | undefined;
    if (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) &&
      !configHeaders?.['Idempotency-Key'] &&
      typeof crypto !== 'undefined' &&
      crypto.randomUUID
    ) {
      config = {
        ...config,
        headers: { ...configHeaders, 'Idempotency-Key': crypto.randomUUID() }
      };
    }

    // Merge configs
    let requestConfig: RequestConfig = {
      ...config,
      headers: {
        'Content-Type': 'application/json',
        ...this.config.headers,
        ...config.headers
      }
    };

    // Set URL for interceptors
    if (this.authInterceptor) {
      this.authInterceptor.setCurrentUrl(fullUrl);
    }
    if (this.encryptionInterceptor) {
      this.encryptionInterceptor.setCurrentUrl(fullUrl);
    }

    // Apply request interceptors
    for (const interceptor of this.requestInterceptors) {
      requestConfig = await interceptor.onRequest(requestConfig);
    }

    // Apply global onRequest hook
    requestConfig = await this.config.onRequest(requestConfig);

    // Handle offline mode
    if (!navigator.onLine && this.shouldQueueOffline(requestConfig)) {
      return this.handleOfflineRequest(fullUrl, requestConfig);
    }

    try {
      // Create abort controller for timeout
      const controller = config.cancelToken || new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      // Make the request
      const response = await fetch(fullUrl, {
        ...requestConfig,
        signal: controller.signal,
        credentials: 'include' // Important: include cookies in requests
      });

      clearTimeout(timeoutId);

      // Parse response
      const result = await this.parseResponse<T>(response);

      // Apply response interceptors
      let processedResult = result;
      for (const interceptor of this.responseInterceptors) {
        if (result.success) {
          processedResult = await interceptor.onResponse(processedResult) as ApiResponse<T>;
        } else {
          await interceptor.onError({
            message: result.message || 'Unknown error',
            status: response.status,
            details: result as unknown as Record<string, unknown>
          });
        }
      }

      // Apply global onResponse hook
      processedResult = await this.config.onResponse(processedResult) as ApiResponse<T>;

      return processedResult;
    } catch (error) {
      const apiError: ApiError = {
        message: error instanceof Error ? error.message : 'Network error',
        status: 0
      };

      // Apply error interceptors
      for (const interceptor of this.responseInterceptors) {
        await interceptor.onError(apiError);
      }

      // Apply global onError hook
      await this.config.onError(apiError);

      // Handle retry logic
      if (this.shouldRetry(error, config)) {
        return this.retryManager.retry(() => this.request<T>(url, config));
      }

      throw apiError;
    }
  }

  /**
   * Convenience methods
   */
  async get<T>(url: string, config?: RequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>(url, { ...config, method: 'GET' });
  }

  async post<T>(url: string, data?: unknown, config?: RequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>(url, {
      ...config,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined
    });
  }

  async put<T>(url: string, data?: unknown, config?: RequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>(url, {
      ...config,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined
    });
  }

  async patch<T>(url: string, data?: unknown, config?: RequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>(url, {
      ...config,
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined
    });
  }

  async delete<T>(url: string, data?: unknown, config?: RequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>(url, {
      ...config,
      method: 'DELETE',
      body: data ? JSON.stringify(data) : undefined
    });
  }

  /**
   * Sync offline queue
   */
  async syncOfflineQueue(): Promise<void> {
    if (this.syncInProgress || !navigator.onLine) {
      return;
    }

    this.syncInProgress = true;
    logger.info('Starting offline queue sync');

    try {
      const queue = await this.offlineQueue.getAll();
      
      for (const item of queue) {
        try {
          await this.processQueuedRequest(item);
          await this.offlineQueue.remove(item.id);
        } catch (error) {
          logger.error(`Failed to sync queued request ${item.id}:`, error);
          await this.offlineQueue.incrementRetries(item.id);
        }
      }
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Get sync status
   */
  async getSyncStatus(): Promise<SyncStatus> {
    const queue = await this.offlineQueue.getAll();
    const pending = queue.filter(item => item.retries === 0).length;
    const failed = queue.filter(item => item.retries > 0).length;

    return {
      lastSync: await this.offlineQueue.getLastSyncTime(),
      pending,
      failed,
      syncing: this.syncInProgress
    };
  }

  /**
   * Resolve entity ID (local to server)
   */
  async resolveId(localId: string, entityType: EntityType): Promise<string> {
    return this.idResolver.resolve(localId, entityType);
  }

  /**
   * Save ID mapping
   */
  async saveIdMapping(mapping: IdMapping): Promise<void> {
    return this.idResolver.saveMapping(mapping);
  }

  /**
   * Private helper methods
   */

  private buildUrl(path: string): string {
    // Handle absolute URLs
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }

    // Remove leading slash from path and trailing slash from base URL
    const cleanBase = this.config.baseUrl.replace(/\/$/, '');
    const cleanPath = path.replace(/^\//, '');

    return `${cleanBase}/${cleanPath}`;
  }

  private async parseResponse<T>(response: Response): Promise<ApiResponse<T>> {
    // Handle no content
    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return {
        success: response.ok,
        data: undefined as T
      };
    }

    // Get response text first (can only read body once)
    let responseText: string;
    try {
      responseText = await response.text();
    } catch (error) {
      return {
        success: false,
        message: 'Failed to read response body',
        status: response.status
      };
    }

    // If empty response
    if (!responseText.trim()) {
      return {
        success: response.ok,
        data: undefined as T
      };
    }

    // Try to parse as JSON
    try {
      const data = JSON.parse(responseText);
      
      // Check if response follows our API format
      if ('success' in data) {
        // Add status code to response
        return {
          ...data,
          status: response.status
        } as ApiResponse<T>;
      }

      // Wrap non-standard responses
      return {
        success: response.ok,
        data: response.ok ? data : undefined,
        message: !response.ok ? data.message || data.error || response.statusText : undefined,
        status: response.status
      };
    } catch (error) {
      // Handle non-JSON responses
      return {
        success: response.ok,
        data: response.ok ? (responseText as unknown as T) : undefined,
        message: !response.ok ? responseText || response.statusText : undefined,
        status: response.status
      };
    }
  }

  private shouldQueueOffline(config: RequestConfig): boolean {
    // Don't queue GET requests or auth endpoints
    return config.method !== 'GET' && !config.skipAuth;
  }

  private async handleOfflineRequest<T>(
    url: string,
    config: RequestConfig
  ): Promise<ApiResponse<T>> {
    // Extract entity info from request
    const entityInfo = this.extractEntityInfo(url, config);

    // Queue the request
    const queuedRequest: QueuedRequest = {
      id: crypto.randomUUID(),
      url,
      method: config.method || 'GET',
      data: config.body ? JSON.parse(config.body as string) : undefined,
      headers: config.headers as Record<string, string>,
      timestamp: Date.now(),
      retries: 0,
      ...entityInfo
    };

    await this.offlineQueue.add(queuedRequest);

    // Return optimistic response
    return {
      success: true,
      data: (queuedRequest.data ? { ...queuedRequest.data, _offline: true } : { _offline: true }) as T,
      message: 'Request queued for offline sync'
    };
  }

  private extractEntityInfo(url: string, config: RequestConfig): Partial<QueuedRequest> {
    // Extract entity type and ID from URL patterns
    const patterns = [
      { regex: /\/tasks\/([^\/]+)/, type: 'task' as EntityType },
      { regex: /\/tasklists\/([^\/]+)/, type: 'task_list' as EntityType },
      { regex: /\/subtasks\/([^\/]+)/, type: 'sub_task' as EntityType },
      { regex: /\/notes\/([^\/]+)/, type: 'note' as EntityType },
      { regex: /\/folders\/([^\/]+)/, type: 'folder' as EntityType },
      { regex: /\/tags\/([^\/]+)/, type: 'tag' as EntityType }
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern.regex);
      if (match) {
        return {
          entityType: pattern.type,
          entityId: match[1],
          operationType: this.getOperationType(config.method)
        };
      }
    }

    return {};
  }

  private getOperationType(method?: string): OperationType | undefined {
    switch (method) {
      case 'POST':
        return 'create';
      case 'PUT':
      case 'PATCH':
        return 'update';
      case 'DELETE':
        return 'delete';
      default:
        return undefined;
    }
  }

  private shouldRetry(error: unknown, config: RequestConfig): boolean {
    // Don't retry if explicitly disabled
    if (config.retries === 0) {
      return false;
    }

    // Only retry on network errors or 5xx status codes
    if (error instanceof Error) {
      return error.message.includes('fetch') || 
             error.message.includes('network') ||
             error.message.includes('timeout');
    }

    return false;
  }

  private async processQueuedRequest(item: QueuedRequest): Promise<void> {
    const config: RequestConfig = {
      method: item.method,
      headers: item.headers,
      body: item.data ? JSON.stringify(item.data) : undefined
    };

    await this.request(item.url, config);
  }
}

// Export singleton instance for convenience
export const apiClient = new ApiClient();
