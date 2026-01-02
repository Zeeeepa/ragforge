/**
 * Base classes and interfaces for testing relationship extraction
 */

// Interface to be implemented
export interface ILogger {
  log(message: string): void;
  error(message: string): void;
}

// Another interface
export interface IConfigurable {
  configure(options: Record<string, unknown>): void;
}

// Base class to be extended
export class BaseService {
  protected name: string;

  constructor(name: string) {
    this.name = name;
  }

  protected init(): void {
    console.log(`Initializing ${this.name}`);
  }
}

// A utility class to be instantiated
export class HttpClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`);
    return response.json();
  }
}

// A helper function to be called
export function createLogger(prefix: string): ILogger {
  return {
    log: (msg) => console.log(`[${prefix}] ${msg}`),
    error: (msg) => console.error(`[${prefix}] ERROR: ${msg}`),
  };
}

// A constant to be referenced
export const DEFAULT_TIMEOUT = 5000;
