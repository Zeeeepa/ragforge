/**
 * Custom decorators for testing DECORATED_BY relationship
 */

// Class decorator
export function Injectable(scope?: string) {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    return class extends constructor {
      __injectable = true;
      __scope = scope || 'singleton';
    };
  };
}

// Method decorator
export function Cacheable(ttl: number = 60) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const cache = new Map<string, { value: any; expiry: number }>();

    descriptor.value = function (...args: any[]) {
      const key = JSON.stringify(args);
      const cached = cache.get(key);

      if (cached && Date.now() < cached.expiry) {
        return cached.value;
      }

      const result = originalMethod.apply(this, args);
      cache.set(key, { value: result, expiry: Date.now() + ttl * 1000 });
      return result;
    };

    return descriptor;
  };
}

// Property decorator
export function Validate(validator: (value: any) => boolean) {
  return function (target: any, propertyKey: string) {
    let value: any;

    Object.defineProperty(target, propertyKey, {
      get: () => value,
      set: (newValue) => {
        if (!validator(newValue)) {
          throw new Error(`Invalid value for ${propertyKey}`);
        }
        value = newValue;
      },
    });
  };
}

// Another class decorator
export function Deprecated(message?: string) {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    console.warn(`${constructor.name} is deprecated. ${message || ''}`);
    return constructor;
  };
}
