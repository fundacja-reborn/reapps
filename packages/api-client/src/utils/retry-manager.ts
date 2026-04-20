import { createLogger } from '@reborn/utils';

const logger = createLogger('RetryManager');

/**
 * Manages retry logic with exponential backoff
 */
export class RetryManager {
  constructor(
    private maxRetries: number = 3,
    private baseDelay: number = 1000,
    private maxDelay: number = 30000
  ) {}

  /**
   * Retry a function with exponential backoff
   */
  async retry<T>(
    fn: () => Promise<T>,
    options?: {
      maxRetries?: number;
      shouldRetry?: (error: unknown, attempt: number) => boolean;
      onRetry?: (error: unknown, attempt: number) => void;
    }
  ): Promise<T> {
    const maxAttempts = options?.maxRetries ?? this.maxRetries;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        // Check if we should retry
        if (attempt === maxAttempts) {
          break;
        }

        // Check custom retry condition
        if (options?.shouldRetry && !options.shouldRetry(error, attempt)) {
          break;
        }

        // Calculate delay with exponential backoff
        const delay = this.calculateDelay(attempt);
        
        logger.warn(
          `Attempt ${attempt + 1}/${maxAttempts + 1} failed, retrying in ${delay}ms:`,
          error instanceof Error ? error.message : error
        );

        // Call onRetry callback
        options?.onRetry?.(error, attempt);

        // Wait before retrying
        await this.sleep(delay);
      }
    }

    logger.error(`All ${maxAttempts + 1} attempts failed`);
    throw lastError;
  }

  /**
   * Retry with custom intervals
   */
  async retryWithIntervals<T>(
    fn: () => Promise<T>,
    intervals: number[]
  ): Promise<T> {
    let lastError: unknown;

    for (let i = 0; i <= intervals.length; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (i === intervals.length) {
          break;
        }

        const delay = intervals[i];
        logger.warn(
          `Attempt ${i + 1}/${intervals.length + 1} failed, retrying in ${delay}ms`
        );

        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  private calculateDelay(attempt: number): number {
    // Exponential backoff: 2^attempt * baseDelay
    const exponentialDelay = Math.pow(2, attempt) * this.baseDelay;
    
    // Add jitter (0-25% of delay)
    const jitter = exponentialDelay * Math.random() * 0.25;
    
    // Cap at maxDelay
    return Math.min(exponentialDelay + jitter, this.maxDelay);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create a retry wrapper for a function
   */
  wrap<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    options?: Parameters<typeof this.retry>[1]
  ): T {
    return (async (...args: Parameters<T>) => {
      return this.retry(() => fn(...args), options);
    }) as T;
  }

  /**
   * Check if error is retryable
   */
  static isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      // Network errors
      if (
        error.message.includes('fetch') ||
        error.message.includes('network') ||
        error.message.includes('timeout') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('ETIMEDOUT')
      ) {
        return true;
      }
    }

    // Check for specific status codes
    if (typeof error === 'object' && error !== null && 'status' in error) {
      const status = (error as any).status;
      // Retry on 5xx errors and specific 4xx errors
      return status >= 500 || status === 429 || status === 408;
    }

    return false;
  }

  /**
   * Create a circuit breaker wrapper
   */
  createCircuitBreaker<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    options: {
      failureThreshold?: number;
      resetTimeout?: number;
      onOpen?: () => void;
      onClose?: () => void;
    } = {}
  ): T {
    const failureThreshold = options.failureThreshold ?? 5;
    const resetTimeout = options.resetTimeout ?? 60000; // 1 minute
    let failures = 0;
    let lastFailureTime = 0;
    let isOpen = false;

    return (async (...args: Parameters<T>) => {
      // Check if circuit should be reset
      if (isOpen && Date.now() - lastFailureTime > resetTimeout) {
        isOpen = false;
        failures = 0;
        options.onClose?.();
        logger.info('Circuit breaker closed');
      }

      // If circuit is open, fail fast
      if (isOpen) {
        throw new Error('Circuit breaker is open');
      }

      try {
        const result = await fn(...args);
        // Reset failures on success
        failures = 0;
        return result;
      } catch (error) {
        failures++;
        lastFailureTime = Date.now();

        if (failures >= failureThreshold) {
          isOpen = true;
          options.onOpen?.();
          logger.error(`Circuit breaker opened after ${failures} failures`);
        }

        throw error;
      }
    }) as T;
  }
}
