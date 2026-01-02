/**
 * Service file that uses all relationship types:
 * - INHERITS_FROM: extends BaseService
 * - IMPLEMENTS: implements ILogger, IConfigurable
 * - DECORATED_BY: @Injectable, @Deprecated
 * - CONSUMES (new): new HttpClient()
 * - CONSUMES (call): createLogger()
 * - USES_LIBRARY: external imports
 */

import {
  BaseService,
  HttpClient,
  ILogger,
  IConfigurable,
  createLogger,
  DEFAULT_TIMEOUT,
} from './base.js';

import { Injectable, Deprecated, Cacheable, Validate } from './decorators.js';

// Class with inheritance + implementation + decorators
@Injectable('singleton')
@Deprecated('Use NewUserService instead')
export class UserService extends BaseService implements ILogger, IConfigurable {
  @Validate((v) => typeof v === 'string' && v.length > 0)
  private userId: string = '';

  private httpClient: HttpClient;
  private logger: ILogger;
  private timeout: number;

  constructor() {
    super('UserService');
    // new Class() - should create CONSUMES relationship
    this.httpClient = new HttpClient('https://api.example.com');
    // Function call - should create CONSUMES relationship
    this.logger = createLogger('UserService');
    // Constant reference
    this.timeout = DEFAULT_TIMEOUT;
  }

  configure(options: Record<string, unknown>): void {
    if (options.timeout) {
      this.timeout = options.timeout as number;
    }
  }

  log(message: string): void {
    this.logger.log(message);
  }

  error(message: string): void {
    this.logger.error(message);
  }

  @Cacheable(300)
  async getUser(id: string): Promise<unknown> {
    return this.httpClient.get(`/users/${id}`);
  }
}

// Another class with generic instantiation
@Injectable()
export class DataService<T> extends BaseService {
  private client: HttpClient;

  constructor(endpoint: string) {
    super('DataService');
    // new with generic - new HttpClient<T>() pattern
    this.client = new HttpClient(endpoint);
  }

  async fetchAll(): Promise<T[]> {
    return this.client.get<T[]>('/');
  }
}

// Function that uses cross-file references
export function createUserService(): UserService {
  const service = new UserService();
  service.configure({ timeout: 10000 });
  return service;
}
