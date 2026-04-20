export interface LogLevel {
  DEBUG: 0;
  INFO: 1;
  WARN: 2;
  ERROR: 3;
}

export interface Logger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  setEnabled(enabled: boolean): void;
  setMinLevel(level: number): void;
}

const LOG_LEVELS: LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

// Color codes for browser console
const LOG_COLORS = {
  debug: '#7f7f7f',
  info: '#0077ff', 
  warn: '#ff9900',
  error: '#ff0000'
};

interface LoggerConfig {
  enabled: boolean;
  minLevel: number;
}

/**
 * Determines default log level based on environment.
 * Reads LOG_LEVEL env var (DEBUG/INFO/WARN/ERROR), falls back to:
 * - WARN in production (NODE_ENV=production)
 * - DEBUG otherwise
 */
function getDefaultMinLevel(): number {
  if (typeof process !== 'undefined' && process.env) {
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    if (envLevel && envLevel in LOG_LEVELS) {
      return LOG_LEVELS[envLevel as keyof LogLevel];
    }
    if (process.env.NODE_ENV === 'production') {
      return LOG_LEVELS.WARN;
    }
  }
  return LOG_LEVELS.DEBUG;
}

// Global configuration
const globalConfig: LoggerConfig = {
  enabled: true,
  minLevel: getDefaultMinLevel()
};

// Module-specific configurations
const moduleConfigs = new Map<string, LoggerConfig>();

/**
 * Global logger control
 */
export const LoggerGlobal = {
  setEnabled(enabled: boolean) {
    globalConfig.enabled = enabled;
  },

  setMinLevel(level: number) {
    globalConfig.minLevel = level;
  },

  getConfig(): LoggerConfig {
    return { ...globalConfig };
  },

  setModuleEnabled(moduleName: string, enabled: boolean) {
    const config = moduleConfigs.get(moduleName) || { 
      enabled: true, 
      minLevel: LOG_LEVELS.DEBUG 
    };
    config.enabled = enabled;
    moduleConfigs.set(moduleName, config);
  },

  setModuleMinLevel(moduleName: string, level: number) {
    const config = moduleConfigs.get(moduleName) || { 
      enabled: true, 
      minLevel: LOG_LEVELS.DEBUG 
    };
    config.minLevel = level;
    moduleConfigs.set(moduleName, config);
  }
};

/**
 * Creates a logger instance for a specific module
 */
export function createLogger(moduleName: string): Logger {
  // Initialize module config if not exists
  if (!moduleConfigs.has(moduleName)) {
    moduleConfigs.set(moduleName, {
      enabled: true,
      minLevel: globalConfig.minLevel
    });
  }

  const shouldLog = (level: number): boolean => {
    if (!globalConfig.enabled) return false;
    if (level < globalConfig.minLevel) return false;

    const config = moduleConfigs.get(moduleName);
    if (!config || !config.enabled) return false;
    return level >= config.minLevel;
  };

  const formatMessage = (level: string, message: string): string => {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${moduleName}] [${level}] ${message}`;
  };

  const logWithColor = (level: string, color: string, message: string, args: any[]) => {
    const formattedMessage = formatMessage(level.toUpperCase(), message);
    const formattedArgs = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
    );
    
    if (typeof window !== 'undefined' && window.console) {
      console.log(`%c${formattedMessage}`, `color: ${color}`, ...formattedArgs);
    } else {
      console.log(formattedMessage, ...formattedArgs);
    }
  };

  return {
    debug(message: string, ...args: any[]): void {
      if (shouldLog(LOG_LEVELS.DEBUG)) {
        logWithColor('debug', LOG_COLORS.debug, message, args);
      }
    },

    info(message: string, ...args: any[]): void {
      if (shouldLog(LOG_LEVELS.INFO)) {
        logWithColor('info', LOG_COLORS.info, message, args);
      }
    },

    warn(message: string, ...args: any[]): void {
      if (shouldLog(LOG_LEVELS.WARN)) {
        if (typeof window !== 'undefined' && window.console) {
          console.warn(formatMessage('WARN', message), ...args);
        } else {
          logWithColor('warn', LOG_COLORS.warn, message, args);
        }
      }
    },

    error(message: string, ...args: any[]): void {
      if (shouldLog(LOG_LEVELS.ERROR)) {
        if (typeof window !== 'undefined' && window.console) {
          console.error(formatMessage('ERROR', message), ...args);
        } else {
          logWithColor('error', LOG_COLORS.error, message, args);
        }
      }
    },

    setEnabled(enabled: boolean): void {
      const config = moduleConfigs.get(moduleName);
      if (config) {
        config.enabled = enabled;
      }
    },

    setMinLevel(level: number): void {
      const config = moduleConfigs.get(moduleName);
      if (config) {
        config.minLevel = level;
      }
    }
  };
}

// Export log levels for convenience
export { LOG_LEVELS };
