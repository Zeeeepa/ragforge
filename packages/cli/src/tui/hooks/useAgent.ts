/**
 * useAgent Hook
 *
 * Manages RagAgent lifecycle and provides callbacks for the TUI.
 * Handles tool confirmation, streaming responses, and state management.
 * Also handles slash commands for persona management.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createRagForgeAgent, type AgentOptions, type AgentProjectContext } from '../../commands/agent.js';
import { getDaemonBrainProxy, type DaemonBrainProxy } from '../../commands/daemon-brain-proxy.js';
import type { TerminalColor } from '@luciformresearch/ragforge';
import { ConversationSummarizer, type ConversationTurn, type ConversationSummary } from './conversation-summarizer.js';

// ============================================
// Wizard System - Step-by-step command helpers
// ============================================

interface WizardStep {
  id: string;
  question: string;
  hint?: string;
  validate?: (value: string) => string | null; // Returns error message or null if valid
  options?: string[]; // If provided, show as choices
}

interface WizardDefinition {
  name: string;
  title: string;
  steps: WizardStep[];
  onComplete: (data: Record<string, string>, brain: DaemonBrainProxy, setIdentity: (id: any) => void) => Promise<string>;
}

interface ActiveWizard {
  definition: WizardDefinition;
  currentStep: number;
  collectedData: Record<string, string>;
}

const VALID_COLORS = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'gray'];

// Wizard definitions
const WIZARDS: Record<string, WizardDefinition> = {
  'create-persona': {
    name: 'create-persona',
    title: '🎭 Create New Persona',
    steps: [
      {
        id: 'name',
        question: 'What name should this persona have?',
        hint: 'e.g., Buddy, CodeMaster, Helper',
        validate: (v) => v.trim().length < 2 ? 'Name must be at least 2 characters' : null,
      },
      {
        id: 'color',
        question: 'Pick a color for the terminal display:',
        options: VALID_COLORS,
        validate: (v) => VALID_COLORS.includes(v.toLowerCase()) ? null : `Invalid color. Choose from: ${VALID_COLORS.join(', ')}`,
      },
      {
        id: 'language',
        question: 'What language should responses be in?',
        hint: 'e.g., en, fr, es, de',
        validate: (v) => v.trim().length < 2 ? 'Use a language code like "en" or "fr"' : null,
      },
      {
        id: 'description',
        question: 'Describe the personality in a few words:',
        hint: 'e.g., A friendly helper who explains things clearly',
        validate: (v) => v.trim().length < 10 ? 'Description should be at least 10 characters' : null,
      },
    ],
    onComplete: async (data, brain, setIdentity) => {
      const persona = await brain.createEnhancedPersona({
        name: data.name,
        color: data.color.toLowerCase(),
        language: data.language.toLowerCase(),
        description: data.description,
      });
      return `✓ Persona **${persona.name}** created!\n\n_${persona.persona}_\n\nUse \`/set-persona ${persona.name}\` to activate it.`;
    },
  },
};

export interface ToolConfirmationRequest {
  id: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  resolve: (confirmed: boolean) => void;
}

export interface AgentMessage {
  id: string;
  type: 'user' | 'assistant' | 'tool';
  content?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolStatus?: 'pending' | 'running' | 'completed' | 'error';
  toolResult?: string;
  toolDuration?: number;
  isStreaming?: boolean;
  agent?: {
    name: string;
    color?: string;
    icon?: string;
  };
}

export interface UseAgentOptions {
  projectPath?: string;
  model?: string;
  verbose?: boolean;
}

// Re-export suggestion types from InputPrompt for convenience
export type { Suggestion, SuggestionSource } from '../components/shared/InputPrompt.js';
import type { SuggestionSource } from '../components/shared/InputPrompt.js';

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface UseAgentReturn {
  messages: AgentMessage[];
  status: 'initializing' | 'idle' | 'thinking' | 'executing' | 'awaiting_confirmation' | 'error';
  pendingConfirmation: ToolConfirmationRequest | null;
  error: string | null;
  /** Suggestion source for InputPrompt (wizard options, etc.) */
  suggestionSource: SuggestionSource | undefined;
  /** Current status text (what the agent is doing) */
  statusText: string | null;
  /** Current todo list */
  todos: TodoItem[];

  // Actions
  sendMessage: (content: string) => Promise<void>;
  confirmTool: (confirmed: boolean) => void;
  reset: () => void;
}

let messageIdCounter = 0;
const generateId = () => `msg_${++messageIdCounter}_${Date.now()}`;

export function useAgent(options: UseAgentOptions = {}): UseAgentReturn {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [status, setStatus] = useState<UseAgentReturn['status']>('initializing');
  const [pendingConfirmation, setPendingConfirmation] = useState<ToolConfirmationRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agentIdentity, setAgentIdentity] = useState<{ name: string; color?: string; icon?: string }>({
    name: 'Assistant',
    color: 'blue',
  });
  const [activeWizard, setActiveWizard] = useState<ActiveWizard | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [todos, setTodos] = useState<TodoItem[]>([]);

  const agentRef = useRef<Awaited<ReturnType<typeof createRagForgeAgent>> | null>(null);
  const contextRef = useRef<AgentProjectContext | null>(null);
  const brainProxyRef = useRef<DaemonBrainProxy | null>(null);
  const initializingRef = useRef(false);

  // Track tool messages by name during execution
  const toolMessageIds = useRef<Map<string, string>>(new Map());
  // Track tool args by name for current turn
  const toolArgsRef = useRef<Map<string, Record<string, any>>>(new Map());

  // Store conversation turns separately (user -> tools -> assistant)
  const conversationTurnsRef = useRef<ConversationTurn[]>([]);
  // Store summaries by level (level 1 = summaries of turns, level 2+ = summaries of summaries)
  const conversationSummariesByLevelRef = useRef<Map<number, ConversationSummary[]>>(new Map());
  const summarizerRef = useRef<ConversationSummarizer | null>(null);
  
  // Track tool results for current turn
  const currentTurnToolsRef = useRef<ConversationTurn['toolResults']>([]);

  // Initialize agent on mount
  useEffect(() => {
    if (initializingRef.current) return;
    initializingRef.current = true;

    const initAgent = async () => {
      try {
        const agentOptions: AgentOptions = {
          project: options.projectPath || process.cwd(),
          model: options.model || 'gemini-2.0-flash',
          verbose: options.verbose || false,

          // Real-time tool call callback
          onToolCall: (toolName: string, args: Record<string, any>) => {
            // Handle notify_user specially - show as assistant message, not tool
            if (toolName === 'notify_user') {
              const message = args.message || args.text || '';
              setStatusText(message);
              // Also add as a transient assistant message
              setMessages(prev => [...prev, {
                id: generateId(),
                type: 'assistant',
                content: `💬 ${message}`,
                isStreaming: false,
                agent: agentIdentity,
              }]);
              return;
            }

            // Handle update_todos - update the todo list display
            if (toolName === 'update_todos') {
              const newTodos = args.todos || [];
              setTodos(newTodos);
              return;
            }

            const msgId = generateId();
            toolMessageIds.current.set(toolName, msgId);
            // Store tool args for later use in turn tracking
            toolArgsRef.current.set(toolName, args);

            // Update status text with current tool
            setStatusText(`Running ${toolName}...`);

            setMessages(prev => [...prev, {
              id: msgId,
              type: 'tool',
              toolName,
              toolArgs: args,
              toolStatus: 'running',
            }]);
          },

          // Real-time tool result callback
          onToolResult: (toolName: string, result: any, success: boolean, durationMs: number) => {
            // notify_user and update_todos don't have results to display
            if (toolName === 'notify_user' || toolName === 'update_todos') {
              return;
            }

            const msgId = toolMessageIds.current.get(toolName);
            if (msgId) {
              setMessages(prev => prev.map(msg =>
                msg.id === msgId
                  ? {
                      ...msg,
                      toolStatus: success ? 'completed' : 'error',
                      toolResult: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                      toolDuration: durationMs,
                    }
                  : msg
              ));
              toolMessageIds.current.delete(toolName);
            }

            // Store tool result for current turn
            const toolArgs = toolArgsRef.current.get(toolName);
            // Clean up after storing
            toolArgsRef.current.delete(toolName);
            
            currentTurnToolsRef.current.push({
              toolName,
              toolArgs,
              toolResult: result,
              success,
              timestamp: Date.now(),
            });

            // Clear status after tool completes
            setStatusText(null);
          },
        };

        const result = await createRagForgeAgent(agentOptions);
        agentRef.current = result;
        contextRef.current = result.context;

        // Initialize conversation summarizer
        if (result.agent && result.context.geminiKey) {
          const { GeminiAPIProvider, StructuredLLMExecutor } = await import('@luciformresearch/ragforge');
          const llmProvider = new GeminiAPIProvider({
            apiKey: result.context.geminiKey,
            model: options.model || 'gemini-2.0-flash',
            temperature: 0.1,
          });
          const executor = new StructuredLLMExecutor();
          
          summarizerRef.current = new ConversationSummarizer({
            maxTurnsBeforeSummarize: 5,
            maxCharsBeforeSummarizeSummaries: 10000,
            llmProvider,
            executor,
          });
        }

        // Get agent identity and brain projects from daemon proxy
        try {
          const brainProxy = await getDaemonBrainProxy();
          brainProxyRef.current = brainProxy;

          // Get active persona
          const persona = await brainProxy.getActivePersona();
          setAgentIdentity({
            name: persona.name,
            color: persona.color as TerminalColor,
            icon: persona.name === 'Ragnarök' ? '✶' : undefined,
          });

          // Log brain projects at startup
          const projects = brainProxy.listProjects();
          console.log(`\n✶ ${persona.name} initialized`);
          if (projects && projects.length > 0) {
            console.log('📚 Brain Projects:');
            for (const p of projects) {
              const status = p.excluded ? ' [excluded]' : '';
              const type = p.type === 'ragforge-project' ? '📦' : (p.type === 'quick-ingest' ? '📂' : '🌐');
              console.log(`  ${type} ${p.id}${status}: ${p.path}`);
            }
          } else {
            console.log('📚 Brain: (No projects indexed yet)');
          }
          console.log('');
        } catch (err: any) {
          // Daemon not available, use default identity
          console.warn('Could not get persona from daemon:', err.message);
        }

        setStatus('idle');
      } catch (err: any) {
        setError(`Failed to initialize agent: ${err.message}`);
        setStatus('error');
      }
    };

    initAgent();

    return () => {
      // Cleanup on unmount
      if (agentRef.current?.context?.registry) {
        agentRef.current.context.registry.dispose().catch(() => {});
      }
    };
  }, [options.projectPath, options.model, options.verbose]);

  // Helper to handle slash commands for persona management
  const handleSlashCommand = useCallback(async (command: string): Promise<string | null> => {
    // Always ensure daemon is running and get proxy
    let brain: DaemonBrainProxy;
    try {
      brain = await getDaemonBrainProxy();
      brainProxyRef.current = brain;
    } catch (err: any) {
      return `⚠️ Could not connect to daemon: ${err.message}`;
    }

    const parts = command.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case '/help': {
        return `📖 **Available Commands:**

**Persona Management:**
  \`/personas\` or \`/list-personas\`
      List all available personas

  \`/set-persona <name|index>\`
      Switch to a different persona
      Examples: \`/set-persona Dev\`, \`/set-persona 2\`

  \`/create-persona Name | color | language | description\`
      Create a new custom persona with LLM-enhanced prompt
      Colors: red, green, yellow, blue, magenta, cyan, white, gray
      Example: \`/create-persona Buddy | cyan | en | A friendly helper\`

  \`/delete-persona <name>\`
      Delete a custom persona (built-ins cannot be deleted)

**Other:**
  \`/help\` - Show this help message

All other input is sent to the RagForge agent.`;
      }

      case '/personas':
      case '/list-personas': {
        const personas = await brain.listPersonas();
        const active = await brain.getActivePersona();
        let output = '📋 **Available Personas:**\n\n';
        personas.forEach((p, i) => {
          const isActive = p.id === active.id;
          const marker = isActive ? ' ✶ (active)' : '';
          const defaultTag = p.isDefault ? '' : ' [custom]';
          output += `  **[${i + 1}]** ${p.name}${marker}${defaultTag}\n`;
          output += `      ${p.description}\n\n`;
        });
        output += '\nUse `/set-persona <name|index>` to switch personas.';
        return output;
      }

      case '/set-persona': {
        if (args.length === 0) {
          return '⚠️ Usage: `/set-persona <name|index>`\n\nExamples:\n  /set-persona Dev\n  /set-persona 2';
        }
        const idOrName = args.join(' ');
        const index = parseInt(idOrName, 10);
        try {
          const persona = await brain.setActivePersona(isNaN(index) ? idOrName : index);
          // Update the agent identity in the UI
          setAgentIdentity({
            name: persona.name,
            color: persona.color as TerminalColor,
            icon: persona.name === 'Ragnarök' ? '✶' : undefined,
          });
          return `✓ Persona switched to: **${persona.name}**\n\n_${persona.persona}_`;
        } catch (err: any) {
          return `⚠️ ${err.message}`;
        }
      }

      case '/create-persona': {
        // Format: /create-persona Name | color | lang | description
        // Example: /create-persona Buddy | cyan | en | A friendly helper who explains things clearly
        const fullArg = args.join(' ');
        const segments = fullArg.split('|').map(s => s.trim());

        if (segments.length < 4) {
          return `⚠️ Usage: \`/create-persona Name | color | language | description\`

**Colors:** red, green, yellow, blue, magenta, cyan, white, gray
**Languages:** en, fr, es, de, it, pt, ja, ko, zh

**Example:**
\`/create-persona Buddy | cyan | en | A friendly helper who explains things clearly\``;
        }

        const [name, color, language, ...descParts] = segments;
        const description = descParts.join('|').trim();

        const validColors = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'gray'];
        if (!validColors.includes(color)) {
          return `⚠️ Invalid color "${color}". Valid colors: ${validColors.join(', ')}`;
        }

        try {
          const persona = await brain.createEnhancedPersona({
            name,
            color: color as TerminalColor,
            language,
            description,
          });
          return `✓ Persona created: **${persona.name}**\n\nGenerated persona:\n_${persona.persona}_\n\nUse \`/set-persona ${persona.name}\` to activate it.`;
        } catch (err: any) {
          return `⚠️ ${err.message}`;
        }
      }

      case '/delete-persona': {
        if (args.length === 0) {
          return '⚠️ Usage: `/delete-persona <name>`\n\nNote: Built-in personas cannot be deleted.';
        }
        const name = args.join(' ');
        try {
          await brain.deletePersona(name);
          return `✓ Persona deleted: **${name}**`;
        } catch (err: any) {
          return `⚠️ ${err.message}`;
        }
      }

      default:
        return null; // Not a persona command
    }
  }, []);

  // Start a wizard
  const startWizard = useCallback((wizardName: string) => {
    const definition = WIZARDS[wizardName];
    if (!definition) return false;

    setActiveWizard({
      definition,
      currentStep: 0,
      collectedData: {},
    });

    // Show wizard title and first question
    const firstStep = definition.steps[0];
    let questionText = `${definition.title}\n\n**Step 1/${definition.steps.length}**: ${firstStep.question}`;
    if (firstStep.hint) {
      questionText += `\n_${firstStep.hint}_`;
    }
    if (firstStep.options) {
      questionText += `\n\nOptions: ${firstStep.options.join(', ')}`;
    }

    setMessages(prev => [...prev, {
      id: generateId(),
      type: 'assistant',
      content: questionText,
      isStreaming: false,
      agent: agentIdentity,
    }]);

    return true;
  }, [agentIdentity]);

  // Handle wizard step input
  const handleWizardInput = useCallback(async (input: string): Promise<boolean> => {
    if (!activeWizard) return false;

    const { definition, currentStep, collectedData } = activeWizard;
    const step = definition.steps[currentStep];
    const value = input.trim();

    // Add user message
    setMessages(prev => [...prev, {
      id: generateId(),
      type: 'user',
      content: value,
    }]);

    // Validate input
    if (step.validate) {
      const error = step.validate(value);
      if (error) {
        setMessages(prev => [...prev, {
          id: generateId(),
          type: 'assistant',
          content: `⚠️ ${error}\n\nPlease try again: ${step.question}`,
          isStreaming: false,
          agent: agentIdentity,
        }]);
        return true; // Handled, but stay on same step
      }
    }

    // Store the answer
    const newData = { ...collectedData, [step.id]: value };
    const nextStep = currentStep + 1;

    // Check if wizard is complete
    if (nextStep >= definition.steps.length) {
      // Wizard complete - run onComplete
      setActiveWizard(null);

      try {
        // Always ensure daemon is running and get proxy
        const brain = await getDaemonBrainProxy();
        brainProxyRef.current = brain;
        const result = await definition.onComplete(newData, brain, setAgentIdentity);
        setMessages(prev => [...prev, {
          id: generateId(),
          type: 'assistant',
          content: result,
          isStreaming: false,
          agent: agentIdentity,
        }]);
      } catch (err: any) {
        setMessages(prev => [...prev, {
          id: generateId(),
          type: 'assistant',
          content: `⚠️ Error: ${err.message}`,
          isStreaming: false,
          agent: agentIdentity,
        }]);
      }
      return true;
    }

    // Move to next step
    setActiveWizard({
      definition,
      currentStep: nextStep,
      collectedData: newData,
    });

    // Show next question
    const nextStepDef = definition.steps[nextStep];
    let questionText = `**Step ${nextStep + 1}/${definition.steps.length}**: ${nextStepDef.question}`;
    if (nextStepDef.hint) {
      questionText += `\n_${nextStepDef.hint}_`;
    }
    if (nextStepDef.options) {
      questionText += `\n\nOptions: ${nextStepDef.options.join(', ')}`;
    }

    setMessages(prev => [...prev, {
      id: generateId(),
      type: 'assistant',
      content: questionText,
      isStreaming: false,
      agent: agentIdentity,
    }]);

    return true;
  }, [activeWizard, agentIdentity]);

  // Compute suggestion source for InputPrompt
  const suggestionSource = useMemo((): SuggestionSource | undefined => {
    if (!activeWizard) return undefined;

    const step = activeWizard.definition.steps[activeWizard.currentStep];
    if (!step.options) return undefined;

    return {
      title: step.question.slice(0, 30) + (step.question.length > 30 ? '...' : ''),
      suggestions: step.options.map(opt => ({ value: opt, label: opt })),
      filter: true, // Filter based on user input
    };
  }, [activeWizard]);

  const sendMessage = useCallback(async (content: string) => {
    // Handle wizard input first (wizard is active even when status is 'idle')
    if (activeWizard) {
      await handleWizardInput(content);
      return;
    }

    if (!agentRef.current || status !== 'idle') return;

    const userMessageId = generateId();

    // Clear tool message tracking for new request
    toolMessageIds.current.clear();

    // Add user message
    setMessages(prev => [...prev, {
      id: userMessageId,
      type: 'user',
      content,
    }]);

    // Check for slash commands
    if (content.trim().startsWith('/')) {
      // Special case: /create-persona starts a wizard
      if (content.trim().toLowerCase() === '/create-persona' || content.trim().toLowerCase().startsWith('/create-persona ')) {
        // Check if inline args provided
        const args = content.trim().slice('/create-persona'.length).trim();
        if (!args) {
          // No args - start wizard
          startWizard('create-persona');
          return;
        }
        // Has args - try inline parsing via handleSlashCommand
      }

      const slashResult = await handleSlashCommand(content.trim());
      if (slashResult !== null) {
        // It was a slash command, show the result
        setMessages(prev => [...prev, {
          id: generateId(),
          type: 'assistant',
          content: slashResult,
          isStreaming: false,
          agent: agentIdentity,
        }]);
        return; // Don't send to agent
      }
    }

    setStatus('thinking');

    try {
      const { agent } = agentRef.current;

      // Build conversation history from summaries and recent turns
      const conversationHistory: Array<{
        role: 'user' | 'assistant';
        content: string;
      }> = [];

      // Add summaries by level (highest level first, then lower levels)
      // Get all summaries, sorted by level (descending) and then by recency
      const allSummaries: Array<{ level: number; summary: ConversationSummary }> = [];
      for (const [level, summaries] of conversationSummariesByLevelRef.current.entries()) {
        for (const summary of summaries) {
          allSummaries.push({ level, summary });
        }
      }
      // Sort by level descending, then take most recent
      allSummaries.sort((a, b) => b.level - a.level);
      
      // Add highest level summaries (most aggregated)
      const highestLevel = allSummaries.length > 0 ? allSummaries[0].level : 0;
      const highestLevelSummaries = allSummaries
        .filter(s => s.level === highestLevel)
        .slice(-2); // Keep last 2 of highest level
      
      for (const { summary } of highestLevelSummaries) {
        conversationHistory.push({
          role: 'assistant',
          content: `[Previous conversation summary (Level ${summary.level})]: ${summary.summary}\n\nKey findings: ${summary.keyFindings.join(', ')}\nFiles mentioned: ${summary.filesMentioned.join(', ')}\nTools used: ${summary.toolsUsed.join(', ')}`,
        });
      }

      // Add recent turns (not yet summarized)
      const recentTurns = conversationTurnsRef.current.slice(-3);
      for (const turn of recentTurns) {
        conversationHistory.push({ role: 'user', content: turn.userMessage });
        conversationHistory.push({ role: 'assistant', content: turn.assistantMessage });
      }

      // Start tracking current turn (will be completed after agent response)
      const currentTurnStartTime = Date.now();
      const currentTurnUserMessage = content;
      
      // Clear tool results and args for new turn
      currentTurnToolsRef.current = [];
      toolArgsRef.current.clear();

      // Call agent with conversation history (tool messages are added via callbacks in real-time)
      const result = await agent.ask(content, conversationHistory.length > 0 ? conversationHistory : undefined);

      // Complete current turn with collected tool results
      const completedTurn: ConversationTurn = {
        userMessage: currentTurnUserMessage,
        assistantMessage: result.answer,
        toolResults: [...currentTurnToolsRef.current], // Copy the array
        timestamp: currentTurnStartTime,
      };

      conversationTurnsRef.current.push(completedTurn);

      // Helper function to recursively check and summarize summaries
      const checkAndSummarizeSummaries = async (level: number) => {
        if (!summarizerRef.current) return;

        const summaries = conversationSummariesByLevelRef.current.get(level) || [];
        
        // Check if summaries at this level should be summarized
        if (summarizerRef.current.shouldSummarizeSummaries(summaries)) {
          // Keep last summary unsummarized for context
          const summariesToSummarize = summaries.slice(0, -1);
          if (summariesToSummarize.length > 0) {
            try {
              const higherLevelSummary = await summarizerRef.current.summarizeSummaries(summariesToSummarize);
              const nextLevel = level + 1;
              
              // Add to next level
              const nextLevelSummaries = conversationSummariesByLevelRef.current.get(nextLevel) || [];
              nextLevelSummaries.push(higherLevelSummary);
              conversationSummariesByLevelRef.current.set(nextLevel, nextLevelSummaries);
              
              // Remove summarized summaries (keep the one we didn't summarize)
              conversationSummariesByLevelRef.current.set(level, summaries.slice(-1));
              
              // Recursively check if next level should be summarized
              checkAndSummarizeSummaries(nextLevel);
            } catch (err) {
              console.error(`Failed to summarize summaries at level ${level}:`, err);
            }
          }
        }
      };

      // Check if we should summarize (async, non-blocking)
      if (summarizerRef.current) {
        // Check if turns should be summarized
        if (summarizerRef.current.shouldSummarize(conversationTurnsRef.current.length)) {
          const turnsToSummarize = conversationTurnsRef.current.slice(0, -2); // Keep last 2 turns unsummarized
          if (turnsToSummarize.length > 0) {
            // Summarize in background (don't block the response)
            summarizerRef.current.summarizeTurns(turnsToSummarize).then(summary => {
              // Add to level 1 summaries
              const level1Summaries = conversationSummariesByLevelRef.current.get(1) || [];
              level1Summaries.push(summary);
              conversationSummariesByLevelRef.current.set(1, level1Summaries);
              
              // Remove summarized turns
              conversationTurnsRef.current = conversationTurnsRef.current.slice(-2);

              // Check if level 1 summaries should be summarized
              checkAndSummarizeSummaries(1);
            }).catch(err => {
              console.error('Failed to summarize conversation:', err);
            });
          }
        }
      }

      // Add assistant message with final response
      setMessages(prev => [...prev, {
        id: generateId(),
        type: 'assistant',
        content: result.answer,
        isStreaming: false,
        agent: agentIdentity,
      }]);

      setStatus('idle');
      setStatusText(null);
    } catch (err: any) {
      setError(err.message);
      setMessages(prev => [...prev, {
        id: generateId(),
        type: 'assistant',
        content: `Error: ${err.message}`,
        agent: agentIdentity,
      }]);
      setStatus('idle');
      setStatusText(null);
    }
  }, [status, handleSlashCommand, agentIdentity, activeWizard, handleWizardInput, startWizard]);

  const confirmTool = useCallback((confirmed: boolean) => {
    if (pendingConfirmation) {
      pendingConfirmation.resolve(confirmed);
      setPendingConfirmation(null);
      setStatus(confirmed ? 'executing' : 'idle');
    }
  }, [pendingConfirmation]);

  const reset = useCallback(() => {
    setMessages([]);
    setError(null);
    setStatus('idle');
  }, []);

  return {
    messages,
    status,
    pendingConfirmation,
    error,
    suggestionSource,
    statusText,
    todos,
    sendMessage,
    confirmTool,
    reset,
  };
}
