/**
 * Document Parser - ContentParser wrapper for document files
 *
 * Wraps the existing DocumentFileParser to implement the ContentParser interface.
 * Defines node types and field extractors for:
 * - PDFDocument: PDF files (.pdf)
 * - WordDocument: Word documents (.docx)
 * - SpreadsheetDocument: Spreadsheets (.xlsx, .xls, .csv)
 * - DocumentFile: Generic document files
 *
 * @module parsers/document-parser
 */

import * as path from 'path';
import type {
  ContentParser,
  NodeTypeDefinition,
  ParseInput,
  ParseOutput,
  ParserNode,
  ParserRelationship,
  FieldExtractors,
  ChunkingConfig,
} from '../parser-types.js';
import {
  parseDocumentFile,
  isDocumentFile,
  type DocumentFileInfo,
  type PDFInfo,
  type DOCXInfo,
  type SpreadsheetInfo,
} from '../../runtime/adapters/document-file-parser.js';
import { hashContent } from '../content-extractor.js';

// ============================================================
// CHUNKING CONFIG
// ============================================================

/**
 * Documents can be long, so we enable chunking by default
 */
const documentChunkingConfig: ChunkingConfig = {
  enabled: true,
  maxSize: 4000,
  overlap: 400,
  strategy: 'paragraph',
};

// ============================================================
// FIELD EXTRACTORS
// ============================================================

/**
 * Field extractors for PDFDocument nodes
 */
const pdfFieldExtractors: FieldExtractors = {
  name: (node) => {
    const file = node.file as string;
    const title = (node.metadata as { title?: string })?.title;
    return title || path.basename(file);
  },

  content: (node) => {
    return node.textContent as string | null ?? null;
  },

  description: (node) => {
    const metadata = node.metadata as {
      title?: string;
      author?: string;
      subject?: string;
    } | undefined;

    if (metadata) {
      const parts: string[] = [];
      if (metadata.title) parts.push(`Title: ${metadata.title}`);
      if (metadata.author) parts.push(`Author: ${metadata.author}`);
      if (metadata.subject) parts.push(`Subject: ${metadata.subject}`);
      return parts.join('. ') || null;
    }
    return null;
  },

  displayPath: (node) => {
    const file = node.file as string;
    const pageCount = node.pageCount as number | undefined;
    if (pageCount) {
      return `${file} (${pageCount} pages)`;
    }
    return file;
  },

  gotoLocation: (node) => ({
    path: node.file as string,
    page: 1,
  }),
};

/**
 * Field extractors for WordDocument nodes
 */
const wordFieldExtractors: FieldExtractors = {
  name: (node) => {
    const file = node.file as string;
    return path.basename(file);
  },

  content: (node) => {
    return node.textContent as string | null ?? null;
  },

  description: (node) => {
    const metadata = node.metadata as { title?: string; author?: string } | undefined;
    if (metadata?.author) {
      return `Author: ${metadata.author}`;
    }
    return null;
  },

  displayPath: (node) => node.file as string,

  gotoLocation: (node) => ({
    path: node.file as string,
  }),
};

/**
 * Field extractors for SpreadsheetDocument nodes
 */
const spreadsheetFieldExtractors: FieldExtractors = {
  name: (node) => {
    const file = node.file as string;
    return path.basename(file);
  },

  content: (node) => {
    // For spreadsheets, content is the text representation
    return node.textContent as string | null ?? null;
  },

  description: (node) => {
    const sheetNames = node.sheetNames as string[] | undefined;
    if (sheetNames && sheetNames.length > 0) {
      return `Sheets: ${sheetNames.join(', ')}`;
    }
    return null;
  },

  displayPath: (node) => {
    const file = node.file as string;
    const sheetCount = (node.sheetNames as string[] | undefined)?.length;
    if (sheetCount) {
      return `${file} (${sheetCount} sheets)`;
    }
    return file;
  },

  gotoLocation: (node) => ({
    path: node.file as string,
  }),
};

/**
 * Field extractors for generic DocumentFile nodes
 */
const documentFieldExtractors: FieldExtractors = {
  name: (node) => {
    const file = node.file as string;
    return path.basename(file);
  },

  content: (node) => node.textContent as string | null ?? null,

  description: () => null,

  displayPath: (node) => node.file as string,

  gotoLocation: (node) => ({
    path: node.file as string,
  }),
};

// ============================================================
// NODE TYPE DEFINITIONS
// ============================================================

const pdfDocumentNodeType: NodeTypeDefinition = {
  label: 'PDFDocument',
  description: 'PDF documents',
  supportsLineNavigation: false,
  uuidStrategy: { type: 'path' },
  fields: pdfFieldExtractors,
  contentHashField: 'hash',
  chunking: documentChunkingConfig,
  additionalRequiredProps: ['file', 'format'],
  indexedProps: ['file', 'format', 'hasSelectableText'],
};

const wordDocumentNodeType: NodeTypeDefinition = {
  label: 'WordDocument',
  description: 'Word documents (.docx)',
  supportsLineNavigation: false,
  uuidStrategy: { type: 'path' },
  fields: wordFieldExtractors,
  contentHashField: 'hash',
  chunking: documentChunkingConfig,
  additionalRequiredProps: ['file', 'format'],
  indexedProps: ['file', 'format'],
};

const spreadsheetDocumentNodeType: NodeTypeDefinition = {
  label: 'SpreadsheetDocument',
  description: 'Spreadsheet documents (.xlsx, .xls, .csv)',
  supportsLineNavigation: false,
  uuidStrategy: { type: 'path' },
  fields: spreadsheetFieldExtractors,
  contentHashField: 'hash',
  chunking: documentChunkingConfig,
  additionalRequiredProps: ['file', 'format'],
  indexedProps: ['file', 'format'],
};

const documentFileNodeType: NodeTypeDefinition = {
  label: 'DocumentFile',
  description: 'Generic document files',
  supportsLineNavigation: false,
  uuidStrategy: { type: 'path' },
  fields: documentFieldExtractors,
  contentHashField: 'hash',
  chunking: documentChunkingConfig,
  additionalRequiredProps: ['file', 'format'],
  indexedProps: ['file', 'format'],
};

// ============================================================
// DOCUMENT PARSER
// ============================================================

/**
 * DocumentParser - ContentParser implementation for document files
 */
export class DocumentParser implements ContentParser {
  readonly name = 'document';
  readonly version = 1;

  readonly supportedExtensions = ['.pdf', '.docx', '.xlsx', '.xls', '.csv'];

  readonly supportedMimeTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
  ];

  readonly nodeTypes: NodeTypeDefinition[] = [
    pdfDocumentNodeType,
    wordDocumentNodeType,
    spreadsheetDocumentNodeType,
    documentFileNodeType,
  ];

  /**
   * Check if this parser can handle a file
   */
  canHandle(filePath: string): boolean {
    return isDocumentFile(filePath);
  }

  /**
   * Parse a document file into nodes and relationships
   */
  async parse(input: ParseInput): Promise<ParseOutput> {
    const startTime = Date.now();
    const nodes: ParserNode[] = [];
    const relationships: ParserRelationship[] = [];
    const warnings: string[] = [];

    try {
      const docInfo = await parseDocumentFile(input.filePath, {
        extractText: true,
        useOcr: true,
      });

      if (!docInfo) {
        warnings.push(`Could not parse document file: ${input.filePath}`);
        return {
          nodes: [],
          relationships: [],
          warnings,
          metadata: {
            parseTimeMs: Date.now() - startTime,
            fileSize: 0,
          },
        };
      }

      // Create node based on format
      const node = this.createNode(docInfo, input.projectId);
      nodes.push(node);

      // Create File wrapper node
      const fileNode = this.createFileNode(input.filePath, input.projectId, node.id);
      nodes.push(fileNode);

      // Relationship: DocumentFile -[:IN_FILE]-> File
      relationships.push({
        type: 'IN_FILE',
        from: node.id,
        to: fileNode.id,
      });

      // Warning if needs Gemini Vision for better OCR
      if (docInfo.needsGeminiVision) {
        warnings.push(`Document ${input.filePath} may need Gemini Vision for better text extraction`);
      }

    } catch (error) {
      warnings.push(`Error parsing ${input.filePath}: ${error}`);
    }

    return {
      nodes,
      relationships,
      warnings: warnings.length > 0 ? warnings : undefined,
      metadata: {
        parseTimeMs: Date.now() - startTime,
        fileSize: nodes.length > 0 ? (nodes[0].properties.sizeBytes as number) : 0,
      },
    };
  }

  /**
   * Create a node from document file info
   */
  private createNode(info: DocumentFileInfo, projectId: string): ParserNode {
    const labels = this.getLabels(info);
    const id = this.generateId(info.file, projectId);

    const properties: Record<string, unknown> = {
      uuid: id,
      projectId,
      sourcePath: info.file,
      sourceType: 'file',
      contentHash: info.hash,
      file: info.file,
      format: info.format,
      sizeBytes: info.sizeBytes,
      pageCount: info.pageCount,
      textContent: info.textContent,
      extractionMethod: info.extractionMethod,
      ocrConfidence: info.ocrConfidence,
      hasFullText: info.hasFullText,
      needsGeminiVision: info.needsGeminiVision,
    };

    // Add format-specific properties
    if (info.metadata) {
      properties.title = info.metadata.title;
      properties.author = info.metadata.author;
      properties.subject = info.metadata.subject;
      properties.creator = info.metadata.creator;
      properties.creationDate = info.metadata.creationDate;
    }

    // PDF-specific
    if (info.format === 'pdf') {
      properties.hasSelectableText = (info as PDFInfo).hasSelectableText;
    }

    // DOCX-specific
    if (info.format === 'docx') {
      properties.htmlContent = (info as DOCXInfo).htmlContent;
    }

    // Spreadsheet-specific
    if (['xlsx', 'xls', 'csv'].includes(info.format)) {
      const spreadsheet = info as SpreadsheetInfo;
      properties.sheetNames = spreadsheet.sheetNames;
      properties.sheets = spreadsheet.sheets;
    }

    return {
      labels,
      id,
      properties,
      position: { type: 'whole' },
    };
  }

  /**
   * Create a File wrapper node
   */
  private createFileNode(filePath: string, projectId: string, docNodeId: string): ParserNode {
    const id = `file:${hashContent(filePath + projectId)}`;

    return {
      labels: ['File'],
      id,
      properties: {
        uuid: id,
        projectId,
        sourcePath: filePath,
        sourceType: 'file',
        contentHash: hashContent(filePath),
        absolutePath: filePath,
        name: path.basename(filePath),
        extension: path.extname(filePath).toLowerCase(),
      },
      position: { type: 'whole' },
    };
  }

  /**
   * Get labels based on document format
   */
  private getLabels(info: DocumentFileInfo): string[] {
    switch (info.format) {
      case 'pdf':
        return ['PDFDocument', 'DocumentFile'];
      case 'docx':
        return ['WordDocument', 'DocumentFile'];
      case 'xlsx':
      case 'xls':
      case 'csv':
        return ['SpreadsheetDocument', 'DocumentFile'];
      default:
        return ['DocumentFile'];
    }
  }

  /**
   * Generate deterministic ID from file path
   */
  private generateId(filePath: string, projectId: string): string {
    return `doc:${hashContent(filePath + projectId)}`;
  }
}

// ============================================================
// SINGLETON & REGISTRATION
// ============================================================

/**
 * Global DocumentParser instance
 */
export const documentParser = new DocumentParser();
