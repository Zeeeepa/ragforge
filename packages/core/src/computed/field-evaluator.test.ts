/**
 * Tests for computed field evaluation
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateComputedField,
  evaluateExpression,
  evaluateComputedFields,
  generateCypherFragment,
  validateComputedField
} from './field-evaluator.js';
import type { ComputedFieldConfig } from '../types/config.js';

describe('evaluateExpression', () => {
  it('should evaluate simple arithmetic', () => {
    const result = evaluateExpression('10 - 5', {});
    expect(result.success).toBe(true);
    expect(result.value).toBe(5);
  });

  it('should evaluate property access', () => {
    const result = evaluateExpression('endLine - startLine', {
      startLine: 10,
      endLine: 50
    });
    expect(result.success).toBe(true);
    expect(result.value).toBe(40);
  });

  it('should evaluate nested property access', () => {
    const result = evaluateExpression('metadata.lines', {
      metadata: { lines: 100 }
    });
    expect(result.success).toBe(true);
    expect(result.value).toBe(100);
  });

  it('should evaluate complex expressions', () => {
    const result = evaluateExpression('(endLine - startLine) * 2 + 1', {
      startLine: 10,
      endLine: 20
    });
    expect(result.success).toBe(true);
    expect(result.value).toBe(21); // (20 - 10) * 2 + 1 = 21
  });

  it('should handle division', () => {
    const result = evaluateExpression('total / count', {
      total: 100,
      count: 4
    });
    expect(result.success).toBe(true);
    expect(result.value).toBe(25);
  });

  it('should handle missing properties', () => {
    const result = evaluateExpression('endLine - startLine', {
      startLine: 10
      // endLine missing
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should handle invalid expressions', () => {
    const result = evaluateExpression('this is not valid', {});
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('evaluateComputedField', () => {
  it('should evaluate expression-based field', () => {
    const field: ComputedFieldConfig = {
      name: 'line_count',
      type: 'number',
      expression: 'endLine - startLine + 1'
    };

    const result = evaluateComputedField(field, {
      startLine: 10,
      endLine: 50
    });

    expect(result.success).toBe(true);
    expect(result.value).toBe(41);
  });

  it('should return cached value for materialized fields', () => {
    const field: ComputedFieldConfig = {
      name: 'line_count',
      type: 'number',
      expression: 'endLine - startLine + 1',
      materialized: true,
      cache_property: 'cached_line_count'
    };

    const result = evaluateComputedField(field, {
      startLine: 10,
      endLine: 50,
      cached_line_count: 999 // Should return this instead of computing
    });

    expect(result.success).toBe(true);
    expect(result.value).toBe(999);
  });

  it('should compute if cached value is missing', () => {
    const field: ComputedFieldConfig = {
      name: 'line_count',
      type: 'number',
      expression: 'endLine - startLine + 1',
      materialized: true,
      cache_property: 'cached_line_count'
    };

    const result = evaluateComputedField(field, {
      startLine: 10,
      endLine: 50
      // cached_line_count missing
    });

    expect(result.success).toBe(true);
    expect(result.value).toBe(41);
  });

  it('should fail for cypher-based fields in core package', () => {
    const field: ComputedFieldConfig = {
      name: 'change_count',
      type: 'number',
      cypher: 'OPTIONAL MATCH (n)-[:HAS_CHANGE]->(c:Change) RETURN count(c) AS change_count'
    };

    const result = evaluateComputedField(field, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('database access');
  });

  it('should fail when no expression or cypher is provided', () => {
    const field: ComputedFieldConfig = {
      name: 'invalid_field',
      type: 'number'
    };

    const result = evaluateComputedField(field, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('No expression or cypher');
  });
});

describe('evaluateComputedFields', () => {
  it('should evaluate multiple fields', () => {
    const fields: ComputedFieldConfig[] = [
      {
        name: 'line_count',
        type: 'number',
        expression: 'endLine - startLine + 1'
      },
      {
        name: 'char_count',
        type: 'number',
        expression: 'source.length'
      }
    ];

    const result = evaluateComputedFields(fields, {
      startLine: 10,
      endLine: 50,
      source: 'hello world'
    });

    expect(result.line_count).toBe(41);
    expect(result.char_count).toBe(11);
  });

  it('should return null for failed computations', () => {
    const fields: ComputedFieldConfig[] = [
      {
        name: 'line_count',
        type: 'number',
        expression: 'endLine - startLine + 1'
      },
      {
        name: 'invalid',
        type: 'number',
        expression: 'missing.property'
      }
    ];

    const result = evaluateComputedFields(fields, {
      startLine: 10,
      endLine: 50
    });

    expect(result.line_count).toBe(41);
    expect(result.invalid).toBeNull();
  });
});

describe('generateCypherFragment', () => {
  it('should generate fragment for materialized field', () => {
    const field: ComputedFieldConfig = {
      name: 'line_count',
      type: 'number',
      materialized: true,
      cache_property: 'cached_line_count'
    };

    const fragment = generateCypherFragment(field, 'n');
    expect(fragment).toBe('n.cached_line_count AS line_count');
  });

  it('should generate fragment for expression field', () => {
    const field: ComputedFieldConfig = {
      name: 'line_count',
      type: 'number',
      expression: 'endLine - startLine + 1'
    };

    const fragment = generateCypherFragment(field, 'n');
    expect(fragment).toBe('n.endLine - n.startLine + 1 AS line_count');
  });

  it('should handle custom node alias', () => {
    const field: ComputedFieldConfig = {
      name: 'line_count',
      type: 'number',
      expression: 'endLine - startLine + 1'
    };

    const fragment = generateCypherFragment(field, 'scope');
    expect(fragment).toBe('scope.endLine - scope.startLine + 1 AS line_count');
  });

  it('should use custom cypher directly', () => {
    const field: ComputedFieldConfig = {
      name: 'change_count',
      type: 'number',
      cypher: 'OPTIONAL MATCH (n)-[:HAS_CHANGE]->(c:Change) RETURN count(c) AS change_count'
    };

    const fragment = generateCypherFragment(field, 'n');
    expect(fragment).toBe('OPTIONAL MATCH (n)-[:HAS_CHANGE]->(c:Change) RETURN count(c) AS change_count');
  });

  it('should return null for fields without computation', () => {
    const field: ComputedFieldConfig = {
      name: 'invalid',
      type: 'number'
    };

    const fragment = generateCypherFragment(field, 'n');
    expect(fragment).toBe('null AS invalid');
  });
});

describe('validateComputedField', () => {
  it('should validate correct field', () => {
    const field: ComputedFieldConfig = {
      name: 'line_count',
      type: 'number',
      expression: 'endLine - startLine + 1'
    };

    const errors = validateComputedField(field);
    expect(errors).toHaveLength(0);
  });

  it('should require name', () => {
    const field: ComputedFieldConfig = {
      name: '',
      type: 'number',
      expression: 'endLine - startLine'
    };

    const errors = validateComputedField(field);
    expect(errors).toContain('Computed field must have a name');
  });

  it('should require type', () => {
    const field: any = {
      name: 'line_count',
      expression: 'endLine - startLine'
    };

    const errors = validateComputedField(field);
    expect(errors).toContain('Computed field must have a type');
  });

  it('should require expression or cypher', () => {
    const field: ComputedFieldConfig = {
      name: 'line_count',
      type: 'number'
    };

    const errors = validateComputedField(field);
    expect(errors).toContain('Computed field must have either expression or cypher');
  });

  it('should not allow both expression and cypher', () => {
    const field: ComputedFieldConfig = {
      name: 'line_count',
      type: 'number',
      expression: 'endLine - startLine',
      cypher: 'n.endLine - n.startLine'
    };

    const errors = validateComputedField(field);
    expect(errors).toContain('Computed field cannot have both expression and cypher');
  });

  it('should require cache_property for materialized fields', () => {
    const field: ComputedFieldConfig = {
      name: 'line_count',
      type: 'number',
      expression: 'endLine - startLine',
      materialized: true
    };

    const errors = validateComputedField(field);
    expect(errors).toContain('Materialized computed field must specify cache_property');
  });
});
