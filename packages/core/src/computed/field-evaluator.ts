/**
 * Runtime evaluation of computed fields
 */
import type { ComputedFieldConfig } from '../types/config.js';

/**
 * Context for field evaluation (entity data)
 */
export interface EvaluationContext {
  [key: string]: any;
}

/**
 * Result of field evaluation
 */
export interface EvaluationResult {
  success: boolean;
  value?: any;
  error?: string;
}

/**
 * Evaluates a computed field against an entity context
 */
export function evaluateComputedField(
  field: ComputedFieldConfig,
  context: EvaluationContext
): EvaluationResult {
  try {
    // If materialized and cached, return cached value
    if (field.materialized && field.cache_property && context[field.cache_property] !== undefined) {
      return {
        success: true,
        value: context[field.cache_property]
      };
    }

    // Evaluate expression or cypher
    if (field.expression) {
      return evaluateExpression(field.expression, context);
    }

    if (field.cypher) {
      // Cypher evaluation requires database access, should be done in runtime package
      return {
        success: false,
        error: 'Cypher evaluation requires database access (use runtime package)'
      };
    }

    return {
      success: false,
      error: 'No expression or cypher defined for computed field'
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Evaluates a simple expression against a context
 * Supports basic arithmetic and property access
 */
export function evaluateExpression(
  expression: string,
  context: EvaluationContext
): EvaluationResult {
  try {
    // Replace property names with context values
    // Support: property, property.nested, arithmetic operators (+, -, *, /)
    const sanitizedExpr = sanitizeExpression(expression, context);

    // Evaluate using Function constructor (safer than eval)
    const fn = new Function('context', `return ${sanitizedExpr}`);
    const value = fn(context);

    return {
      success: true,
      value
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Sanitizes an expression by replacing property names with context access
 * Example: "endLine - startLine" -> "context.endLine - context.startLine"
 * Example: "source.length" -> "context.source.length"
 */
function sanitizeExpression(expression: string, context: EvaluationContext): string {
  // Match identifiers that start a property access chain
  // We only need to prefix the root identifier with "context."
  const identifierPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)(?=\s|[^\w.]|$|\.[a-zA-Z_])/g;

  return expression.replace(identifierPattern, (match) => {
    // Don't replace JavaScript keywords or operators
    const keywords = new Set([
      'true', 'false', 'null', 'undefined',
      'typeof', 'instanceof', 'new', 'this',
      'return', 'if', 'else', 'for', 'while', 'do',
      'switch', 'case', 'break', 'continue', 'default',
      'function', 'var', 'let', 'const', 'class', 'extends'
    ]);

    if (keywords.has(match)) {
      return match;
    }

    // Check if this is a root property in context
    if (match in context) {
      return `context.${match}`;
    }

    // Not in context - keep as is (will error during evaluation)
    return match;
  });
}

/**
 * Generates a Cypher fragment for a computed field
 * This is used in query building to include computed fields in RETURN clauses
 */
export function generateCypherFragment(
  field: ComputedFieldConfig,
  nodeAlias: string = 'n'
): string {
  // If materialized, return cached property
  if (field.materialized && field.cache_property) {
    return `${nodeAlias}.${field.cache_property} AS ${field.name}`;
  }

  // If expression, convert to Cypher
  if (field.expression) {
    const cypherExpr = expressionToCypher(field.expression, nodeAlias);
    return `${cypherExpr} AS ${field.name}`;
  }

  // If custom Cypher, use it directly
  if (field.cypher) {
    // Custom Cypher should already include AS clause
    return field.cypher;
  }

  return `null AS ${field.name}`;
}

/**
 * Converts a simple expression to Cypher syntax
 * Example: "endLine - startLine" -> "n.endLine - n.startLine"
 */
function expressionToCypher(expression: string, nodeAlias: string): string {
  const identifierPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\b/g;

  return expression.replace(identifierPattern, (match) => {
    // Don't replace Cypher keywords
    const keywords = new Set([
      'true', 'false', 'null',
      'AND', 'OR', 'NOT', 'XOR',
      'IN', 'IS', 'AS',
      'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
      'CASE', 'WHEN', 'THEN', 'ELSE', 'END'
    ]);

    if (keywords.has(match.toUpperCase())) {
      return match;
    }

    // Replace with node property access
    return `${nodeAlias}.${match}`;
  });
}

/**
 * Validates a computed field configuration
 */
export function validateComputedField(field: ComputedFieldConfig): string[] {
  const errors: string[] = [];

  if (!field.name) {
    errors.push('Computed field must have a name');
  }

  if (!field.type) {
    errors.push('Computed field must have a type');
  }

  if (!field.expression && !field.cypher) {
    errors.push('Computed field must have either expression or cypher');
  }

  if (field.expression && field.cypher) {
    errors.push('Computed field cannot have both expression and cypher');
  }

  if (field.materialized && !field.cache_property) {
    errors.push('Materialized computed field must specify cache_property');
  }

  return errors;
}

/**
 * Batch evaluates multiple computed fields for an entity
 */
export function evaluateComputedFields(
  fields: ComputedFieldConfig[],
  context: EvaluationContext
): Record<string, any> {
  const result: Record<string, any> = {};

  for (const field of fields) {
    const evalResult = evaluateComputedField(field, context);
    if (evalResult.success) {
      result[field.name] = evalResult.value;
    } else {
      // Return null for failed computations
      result[field.name] = null;
    }
  }

  return result;
}
