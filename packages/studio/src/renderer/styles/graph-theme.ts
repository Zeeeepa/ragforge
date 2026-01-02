/**
 * Graph Theme - Colors for nodes and relationships
 *
 * Consistent color scheme for the graph visualization.
 */

// Relationship colors (edges)
export const RELATIONSHIP_COLORS = {
  // Code flow (warm colors)
  CONSUMES: '#EF4444',      // red - dependencies
  CONSUMED_BY: '#F97316',   // orange - reverse dependencies

  // Structure (cool colors)
  DEFINED_IN: '#3B82F6',    // blue - scope in file
  HAS_PARENT: '#A855F7',    // purple - scope hierarchy
  PARENT_OF: '#A855F7',     // purple - scope hierarchy

  // Inheritance (gold/yellow)
  INHERITS_FROM: '#F59E0B', // amber - inheritance
  IMPLEMENTS: '#FBBF24',    // yellow - interface implementation

  // External (cyan/teal)
  USES_LIBRARY: '#06B6D4',  // cyan - external libs
  IMPORTS: '#10B981',       // green - imports

  // Documents (pink/magenta)
  HAS_SECTION: '#EC4899',   // pink - doc sections
  CHILD_OF: '#F472B6',      // light pink - section hierarchy
  CONTAINS_CODE: '#14B8A6', // teal - code blocks in docs

  // Web (indigo)
  LINKS_TO: '#6366F1',      // indigo - web links

  // File structure (gray)
  IN_DIRECTORY: '#6B7280',  // gray - file in directory
} as const;

// Node type colors
export const NODE_COLORS = {
  function: {
    bg: 'bg-blue-900/50',
    border: 'border-blue-500',
    text: 'text-blue-300',
    hex: '#3B82F6',
  },
  class: {
    bg: 'bg-purple-900/50',
    border: 'border-purple-500',
    text: 'text-purple-300',
    hex: '#8B5CF6',
  },
  method: {
    bg: 'bg-green-900/50',
    border: 'border-green-500',
    text: 'text-green-300',
    hex: '#22C55E',
  },
  variable: {
    bg: 'bg-orange-900/50',
    border: 'border-orange-500',
    text: 'text-orange-300',
    hex: '#F97316',
  },
  interface: {
    bg: 'bg-cyan-900/50',
    border: 'border-cyan-500',
    text: 'text-cyan-300',
    hex: '#06B6D4',
  },
  library: {
    bg: 'bg-teal-900/50',
    border: 'border-teal-500',
    text: 'text-teal-300',
    hex: '#14B8A6',
  },
  file: {
    bg: 'bg-amber-900/50',
    border: 'border-amber-500',
    text: 'text-amber-300',
    hex: '#F59E0B',
  },
  document: {
    bg: 'bg-pink-900/50',
    border: 'border-pink-500',
    text: 'text-pink-300',
    hex: '#EC4899',
  },
  default: {
    bg: 'bg-gray-700/50',
    border: 'border-gray-500',
    text: 'text-gray-300',
    hex: '#6B7280',
  },
} as const;

// Animation styles for new nodes/edges
export const ANIMATION_CLASSES = {
  nodeAppear: 'animate-node-appear',
  edgeDrawn: 'animate-edge-drawn',
  pulse: 'animate-pulse-glow',
} as const;

/**
 * Get the color for an edge based on its relationship type
 */
export function getEdgeColor(type: string): string {
  return RELATIONSHIP_COLORS[type as keyof typeof RELATIONSHIP_COLORS] || '#6B7280';
}

/**
 * Get the color config for a node type
 */
export function getNodeColor(type: string) {
  return NODE_COLORS[type as keyof typeof NODE_COLORS] || NODE_COLORS.default;
}

/**
 * Generate a glow effect for a color
 */
export function getGlowColor(hexColor: string): string {
  // Make the color slightly more transparent for glow effect
  return hexColor + '40'; // 25% opacity
}
