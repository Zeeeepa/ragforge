/**
 * Conversation Summarizer
 * 
 * Summarizes conversation turns (user -> tools -> assistant) when they exceed a threshold.
 * Uses LLM to extract structured information including files mentioned, key findings, etc.
 */

import type { StructuredLLMExecutor } from '@luciformresearch/ragforge';
import type { LLMProvider } from '@luciformresearch/ragforge';

export interface ConversationTurn {
  userMessage: string;
  assistantMessage: string;
  toolResults: Array<{
    toolName: string;
    toolArgs?: Record<string, any>;
    toolResult: any;
    success: boolean;
    timestamp: number;
  }>;
  timestamp: number;
}

export interface ConversationSummary {
  summary: string;
  filesMentioned: string[];
  keyFindings: string[];
  toolsUsed: string[];
  topics: string[];
  turnCount: number;
  level: number; // 1 = summary of turns, 2+ = summary of summaries
  charCount: number; // Total character count of this summary
}

export interface ConversationSummarizerOptions {
  maxTurnsBeforeSummarize: number; // Default: 5
  maxCharsBeforeSummarizeSummaries: number; // Default: 10000
  llmProvider: LLMProvider;
  executor: StructuredLLMExecutor;
}

export class ConversationSummarizer {
  private maxTurnsBeforeSummarize: number;
  private maxCharsBeforeSummarizeSummaries: number;
  private llmProvider: LLMProvider;
  private executor: StructuredLLMExecutor;

  constructor(options: ConversationSummarizerOptions) {
    this.maxTurnsBeforeSummarize = options.maxTurnsBeforeSummarize ?? 5;
    this.maxCharsBeforeSummarizeSummaries = options.maxCharsBeforeSummarizeSummaries ?? 10000;
    this.llmProvider = options.llmProvider;
    this.executor = options.executor;
  }

  /**
   * Summarize conversation turns using LLM
   */
  async summarizeTurns(turns: ConversationTurn[]): Promise<ConversationSummary> {
    if (turns.length === 0) {
      return {
        summary: '',
        filesMentioned: [],
        keyFindings: [],
        toolsUsed: [],
        topics: [],
        turnCount: 0,
        level: 1,
        charCount: 0,
      };
    }

    // Format turns for LLM
    const formattedTurns = turns.map((turn, i) => {
      const toolsInfo = turn.toolResults.length > 0
        ? `\nTools used:\n${turn.toolResults.map(tr => {
            const argsStr = tr.toolArgs ? `(${JSON.stringify(tr.toolArgs).substring(0, 100)}...)` : '';
            const resultStr = typeof tr.toolResult === 'string'
              ? tr.toolResult.substring(0, 200)
              : JSON.stringify(tr.toolResult).substring(0, 200);
            return `- ${tr.toolName}${argsStr}: ${resultStr}${resultStr.length >= 200 ? '...' : ''}`;
          }).join('\n')}`
        : '';

      return `Turn ${i + 1}:
User: ${turn.userMessage}
Assistant: ${turn.assistantMessage}${toolsInfo}`;
    }).join('\n\n');

    // Generate structured summary with LLM
    const result = await this.executor.executeLLMBatch(
      [{ conversation: formattedTurns }],
      {
        caller: 'ConversationSummarizer.summarizeTurns',
        inputFields: ['conversation'],
        systemPrompt: `You are analyzing a conversation between a user and an AI assistant. 
Extract structured information including files mentioned, key findings, tools used, and topics discussed.`,
        userTask: `Analyze this conversation and extract structured information:

1. Create a concise summary (3-4 sentences) of what was discussed
2. Extract ALL file paths mentioned (from tool results, user messages, assistant messages)
3. List key findings or important information discovered
4. List all tools that were used
5. Identify main topics discussed

Be thorough in extracting file paths - they might be mentioned in tool arguments, tool results, or messages.`,
        outputSchema: {
          summary: {
            type: 'string',
            description: 'Concise summary of the conversation (3-4 sentences)',
            required: true,
          },
          filesMentioned: {
            type: 'array',
            description: 'All file paths mentioned in the conversation (extract from tool args, results, messages)',
            items: {
              type: 'string',
              description: 'A file path',
            },
            required: true,
          },
          keyFindings: {
            type: 'array',
            description: 'Key findings or important information discovered (3-5 items)',
            items: {
              type: 'string',
              description: 'A key finding',
            },
            required: true,
          },
          toolsUsed: {
            type: 'array',
            description: 'All tools that were used (unique list)',
            items: {
              type: 'string',
              description: 'A tool name',
            },
            required: true,
          },
          topics: {
            type: 'array',
            description: 'Main topics discussed (2-4 topics)',
            items: {
              type: 'string',
              description: 'A topic',
            },
            required: true,
          },
        },
        llmProvider: this.llmProvider,
        batchSize: 1,
      }
    );

    const rawResult: any = Array.isArray(result) ? result[0] : result;

    const summary = String(rawResult.summary || '');
    const filesMentioned = Array.isArray(rawResult.filesMentioned) ? rawResult.filesMentioned : [];
    const keyFindings = Array.isArray(rawResult.keyFindings) ? rawResult.keyFindings : [];
    const toolsUsed = Array.isArray(rawResult.toolsUsed) ? rawResult.toolsUsed : [];
    const topics = Array.isArray(rawResult.topics) ? rawResult.topics : [];
    
    // Calculate character count
    const charCount = summary.length + 
      filesMentioned.join(', ').length +
      keyFindings.join(', ').length +
      toolsUsed.join(', ').length +
      topics.join(', ').length;

    return {
      summary,
      filesMentioned,
      keyFindings,
      toolsUsed,
      topics,
      turnCount: turns.length,
      level: 1, // Level 1 = summary of turns
      charCount,
    };
  }

  /**
   * Summarize summaries (create higher-level summary)
   */
  async summarizeSummaries(summaries: ConversationSummary[]): Promise<ConversationSummary> {
    if (summaries.length === 0) {
      throw new Error('Cannot summarize empty summaries array');
    }

    // Format summaries for LLM
    const formattedSummaries = summaries.map((s, i) => {
      return `Summary ${i + 1} (Level ${s.level}, ${s.turnCount} turns):
Summary: ${s.summary}
Files: ${s.filesMentioned.join(', ')}
Findings: ${s.keyFindings.join('; ')}
Tools: ${s.toolsUsed.join(', ')}
Topics: ${s.topics.join(', ')}`;
    }).join('\n\n');

    // Generate structured summary of summaries
    const result = await this.executor.executeLLMBatch(
      [{ summaries: formattedSummaries }],
      {
        caller: 'ConversationSummarizer.summarizeSummaries',
        inputFields: ['summaries'],
        systemPrompt: `You are analyzing multiple conversation summaries to create a higher-level summary.
Synthesize the information, merge duplicate files/findings, and create a coherent overview.`,
        userTask: `Analyze these conversation summaries and create a synthesized higher-level summary:

1. Create a concise summary (4-5 sentences) that synthesizes all the summaries
2. Merge and deduplicate ALL file paths mentioned across all summaries
3. Combine and prioritize key findings (5-7 most important items)
4. Merge all tools used (unique list)
5. Identify main topics across all summaries (3-5 topics)

Be thorough in extracting and merging information.`,
        outputSchema: {
          summary: {
            type: 'string',
            description: 'Synthesized summary of all summaries (4-5 sentences)',
            required: true,
          },
          filesMentioned: {
            type: 'array',
            description: 'All unique file paths mentioned across all summaries',
            items: {
              type: 'string',
              description: 'A file path',
            },
            required: true,
          },
          keyFindings: {
            type: 'array',
            description: 'Combined and prioritized key findings (5-7 items)',
            items: {
              type: 'string',
              description: 'A key finding',
            },
            required: true,
          },
          toolsUsed: {
            type: 'array',
            description: 'All unique tools used across all summaries',
            items: {
              type: 'string',
              description: 'A tool name',
            },
            required: true,
          },
          topics: {
            type: 'array',
            description: 'Main topics across all summaries (3-5 topics)',
            items: {
              type: 'string',
              description: 'A topic',
            },
            required: true,
          },
        },
        llmProvider: this.llmProvider,
        batchSize: 1,
      }
    );

    const rawResult: any = Array.isArray(result) ? result[0] : result;

    const summary = String(rawResult.summary || '');
    const filesMentioned = Array.isArray(rawResult.filesMentioned) ? rawResult.filesMentioned : [];
    const keyFindings = Array.isArray(rawResult.keyFindings) ? rawResult.keyFindings : [];
    const toolsUsed = Array.isArray(rawResult.toolsUsed) ? rawResult.toolsUsed : [];
    const topics = Array.isArray(rawResult.topics) ? rawResult.topics : [];

    // Calculate character count
    const charCount = summary.length + 
      filesMentioned.join(', ').length +
      keyFindings.join(', ').length +
      toolsUsed.join(', ').length +
      topics.join(', ').length;

    // Calculate total turn count from all summaries
    const totalTurnCount = summaries.reduce((sum, s) => sum + s.turnCount, 0);

    // Level is one higher than the highest level in summaries
    const maxLevel = Math.max(...summaries.map(s => s.level));
    
    return {
      summary,
      filesMentioned,
      keyFindings,
      toolsUsed,
      topics,
      turnCount: totalTurnCount,
      level: maxLevel + 1,
      charCount,
    };
  }

  /**
   * Check if turns should be summarized
   */
  shouldSummarize(turnCount: number): boolean {
    return turnCount >= this.maxTurnsBeforeSummarize;
  }

  /**
   * Check if summaries should be summarized (based on character count)
   */
  shouldSummarizeSummaries(summaries: ConversationSummary[]): boolean {
    const totalChars = summaries.reduce((sum, s) => sum + s.charCount, 0);
    return totalChars >= this.maxCharsBeforeSummarizeSummaries;
  }

  /**
   * Get total character count of summaries
   */
  getTotalCharCount(summaries: ConversationSummary[]): number {
    return summaries.reduce((sum, s) => sum + s.charCount, 0);
  }
}
