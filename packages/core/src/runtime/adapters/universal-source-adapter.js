/**
 * Universal Source Adapter
 *
 * Auto-detects and parses any source type into Neo4j graph structure.
 *
 * Supported source types:
 * - 'files': Local files (code, documents, media) - auto-detected by extension
 * - 'database': Database schema/data (PostgreSQL, MySQL, MongoDB, etc.) - placeholder
 * - 'web': Web pages via Playwright crawler
 * - 'api': REST/GraphQL APIs - placeholder
 *
 * For 'files' type, supports:
 * - Code: .ts, .tsx, .js, .jsx, .py, .vue, .svelte, .html, .css, .scss
 * - Documents: .pdf, .docx, .xlsx, .xls, .csv
 * - Data: .json, .yaml, .yml, .xml, .toml, .env
 * - Media: .png, .jpg, .jpeg, .gif, .webp, .svg, .gltf, .glb
 * - Markdown: .md, .mdx
 *
 * @since 2025-12-07
 */
import { CodeSourceAdapter } from './code-source-adapter.js';
import { DatabaseAdapter } from './database-adapter.js';
import { WebAdapter } from './web-adapter.js';
import { APIAdapter } from './api-adapter.js';
import { SourceAdapter, } from './types.js';
/**
 * Normalize source configuration for file-based sources
 */
function normalizeFileSourceConfig(config) {
    if (config.adapter) {
        console.warn('[UniversalSourceAdapter] Deprecation warning: "adapter" field is ignored. ' +
            'File types are auto-detected based on extension.');
    }
    return {
        ...config,
        type: 'code',
        adapter: 'auto',
    };
}
/**
 * Universal Source Adapter
 *
 * Parses any supported source type into Neo4j graph structure.
 * Dispatches to appropriate sub-adapter based on source type.
 */
export class UniversalSourceAdapter extends SourceAdapter {
    type = 'universal';
    adapterName = 'universal';
    codeAdapter;
    databaseAdapter;
    webAdapter;
    apiAdapter;
    constructor() {
        super();
        this.codeAdapter = new CodeSourceAdapter('auto');
        this.databaseAdapter = new DatabaseAdapter();
        this.webAdapter = new WebAdapter();
        this.apiAdapter = new APIAdapter();
    }
    /**
     * Parse source into Neo4j graph structure
     */
    async parse(options) {
        const sourceType = options.source.type;
        // Normalize legacy types
        const normalizedType = (sourceType === 'code' || sourceType === 'document')
            ? 'files'
            : sourceType;
        switch (normalizedType) {
            case 'files':
                return this.parseFiles(options);
            case 'database':
                return this.databaseAdapter.parse(options);
            case 'web':
                return this.webAdapter.parse(options);
            case 'api':
                return this.apiAdapter.parse(options);
            default:
                // Default to files for backward compatibility
                return this.parseFiles(options);
        }
    }
    /**
     * Parse file-based sources
     */
    async parseFiles(options) {
        const normalizedConfig = normalizeFileSourceConfig(options.source);
        return this.codeAdapter.parse({
            ...options,
            source: normalizedConfig,
        });
    }
    /**
     * Validate source configuration
     */
    async validate(config) {
        const sourceType = config.type;
        const normalizedType = (sourceType === 'code' || sourceType === 'document')
            ? 'files'
            : sourceType;
        switch (normalizedType) {
            case 'files':
                const normalizedConfig = normalizeFileSourceConfig(config);
                return this.codeAdapter.validate(normalizedConfig);
            case 'database':
                return this.databaseAdapter.validate(config);
            case 'web':
                return this.webAdapter.validate(config);
            case 'api':
                return this.apiAdapter.validate(config);
            default:
                return { valid: true };
        }
    }
}
/**
 * Create a universal source adapter instance
 */
export function createUniversalSourceAdapter() {
    return new UniversalSourceAdapter();
}
// Keep old name as alias for backward compatibility
export const UniversalFileAdapter = UniversalSourceAdapter;
export const createUniversalFileAdapter = createUniversalSourceAdapter;
/**
 * Detect file category from extension
 */
export function detectFileCategory(filePath) {
    const ext = filePath.toLowerCase().split('.').pop() || '';
    const codeExts = ['ts', 'tsx', 'js', 'jsx', 'py', 'vue', 'svelte', 'html', 'htm', 'css', 'scss', 'sass', 'astro'];
    if (codeExts.includes(ext))
        return 'code';
    const docExts = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'csv'];
    if (docExts.includes(ext))
        return 'document';
    const dataExts = ['json', 'yaml', 'yml', 'xml', 'toml', 'env'];
    if (dataExts.includes(ext))
        return 'data';
    const mediaExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'tiff', 'gltf', 'glb', 'obj'];
    if (mediaExts.includes(ext))
        return 'media';
    const mdExts = ['md', 'mdx', 'markdown'];
    if (mdExts.includes(ext))
        return 'markdown';
    return 'unknown';
}
/**
 * Get recommended include patterns for a directory
 */
export async function detectIncludePatterns(rootPath) {
    const { globby } = await import('globby');
    const fs = await import('fs/promises');
    const path = await import('path');
    try {
        await fs.access(rootPath);
    }
    catch {
        return ['**/*'];
    }
    const sampleFiles = await globby(['**/*'], {
        cwd: rootPath,
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/.ragforge/**', '**/__pycache__/**', '**/target/**'],
        onlyFiles: true,
        deep: 3,
    });
    const extensions = new Set();
    for (const file of sampleFiles.slice(0, 100)) {
        const ext = path.extname(file).toLowerCase();
        if (ext)
            extensions.add(ext);
    }
    const patterns = [];
    const allExts = [
        ['.ts', '.tsx', '.js', '.jsx', '.py', '.vue', '.svelte', '.html', '.css', '.scss'],
        ['.pdf', '.docx', '.xlsx', '.csv'],
        ['.json', '.yaml', '.yml', '.xml'],
        ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.gltf', '.glb'],
        ['.md', '.mdx'],
    ].flat();
    for (const ext of allExts) {
        if (extensions.has(ext)) {
            patterns.push(`**/*${ext}`);
        }
    }
    if (patterns.length === 0) {
        return ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.py', '**/*.md', '**/*.json'];
    }
    return patterns;
}
//# sourceMappingURL=universal-source-adapter.js.map