/**
 * Source Adapter Types
 *
 * Types and interfaces for RagForge source adapters that parse various
 * sources (code, documents, APIs, etc.) into Neo4j graph structures.
 */
/**
 * Abstract base class for source adapters
 */
export class SourceAdapter {
    /** Type of source this adapter handles */
    type = '';
    /** Name of this specific adapter implementation */
    adapterName = '';
    /**
     * Parse source into Neo4j graph structure
     */
    async parse(options) {
        throw new Error('Not implemented');
    }
    /**
     * Validate source configuration before parsing
     */
    async validate(config) {
        throw new Error('Not implemented');
    }
}
//# sourceMappingURL=types.js.map