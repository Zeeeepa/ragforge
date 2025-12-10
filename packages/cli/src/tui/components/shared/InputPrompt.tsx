import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

// ============================================
// Suggestion System - Unified autocomplete
// ============================================

export interface Suggestion {
  value: string;
  label?: string;  // Display label (defaults to value)
  desc?: string;   // Description shown after
}

export interface SuggestionSource {
  title?: string;
  suggestions: Suggestion[];
  /** If true, filter suggestions based on input. If false, show all. */
  filter?: boolean;
}

// Default slash commands
const SLASH_COMMANDS: Suggestion[] = [
  { value: '/help', desc: 'Show available commands' },
  { value: '/personas', desc: 'List all personas' },
  { value: '/set-persona', desc: 'Switch persona (name or index)' },
  { value: '/create-persona', desc: 'Create new persona (wizard)' },
  { value: '/delete-persona', desc: 'Delete a custom persona' },
];

interface InputPromptProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Custom suggestions to show instead of slash commands */
  suggestionSource?: SuggestionSource;
}

export const InputPrompt: React.FC<InputPromptProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder = 'Type a message...',
  disabled = false,
  suggestionSource,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Compute suggestions based on source or default slash commands
  const { title, suggestions } = useMemo(() => {
    // If custom suggestion source provided (e.g., wizard options)
    if (suggestionSource) {
      const { title, suggestions: srcSuggestions, filter = true } = suggestionSource;
      if (!filter) {
        // Show all suggestions (wizard options)
        return { title, suggestions: srcSuggestions };
      }
      // Filter based on input
      const input = value.toLowerCase().trim();
      const filtered = input
        ? srcSuggestions.filter(s =>
            s.value.toLowerCase().startsWith(input) ||
            s.label?.toLowerCase().startsWith(input)
          )
        : srcSuggestions;
      return { title, suggestions: filtered };
    }

    // Default: slash commands
    if (!value.startsWith('/')) return { title: undefined, suggestions: [] };
    // Don't show suggestions if there's already a space (command is complete)
    if (value.includes(' ') && value.trim().split(' ').length > 1) {
      return { title: undefined, suggestions: [] };
    }
    const input = value.toLowerCase().trim();
    const filtered = SLASH_COMMANDS.filter(s => s.value.toLowerCase().startsWith(input));
    return { title: 'Commands', suggestions: filtered };
  }, [value, suggestionSource]);

  // Reset selection when suggestions change
  const prevSuggestionsLength = React.useRef(suggestions.length);
  if (suggestions.length !== prevSuggestionsLength.current) {
    prevSuggestionsLength.current = suggestions.length;
    if (selectedIndex >= suggestions.length) {
      setSelectedIndex(Math.max(0, suggestions.length - 1));
    }
  }

  // Handle Tab and arrow keys for autocomplete
  useInput((input, key) => {
    if (disabled) return;

    // Tab for autocomplete (fills the input)
    if (key.tab && suggestions.length > 0) {
      const selected = suggestions[selectedIndex];
      if (selected) {
        // For slash commands, add space if command takes args
        if (selected.value.startsWith('/')) {
          const noSpace = ['/help', '/personas'];
          onChange(selected.value + (noSpace.includes(selected.value) ? '' : ' '));
        } else {
          // For wizard options, just set the value
          onChange(selected.value);
        }
      }
    }

    // Arrow keys for navigation
    if (suggestions.length > 0) {
      if (key.upArrow) {
        setSelectedIndex(i => (i > 0 ? i - 1 : suggestions.length - 1));
      } else if (key.downArrow) {
        setSelectedIndex(i => (i < suggestions.length - 1 ? i + 1 : 0));
      }
    }
  });

  const showSuggestions = !disabled && suggestions.length > 0;

  // Custom submit handler: if wizard suggestions are shown and input is empty/partial,
  // submit the selected suggestion instead
  const handleSubmit = (submittedValue: string) => {
    // If we have wizard suggestions (non-slash command suggestions)
    if (suggestionSource && suggestions.length > 0) {
      const selected = suggestions[selectedIndex];
      if (selected && !selected.value.startsWith('/')) {
        // Submit the selected wizard option
        onSubmit(selected.value);
        return;
      }
    }
    // Otherwise submit as-is
    onSubmit(submittedValue);
  };

  return (
    <Box flexDirection="column">
      {/* Autocomplete suggestions */}
      {showSuggestions && (
        <Box flexDirection="column" marginBottom={0} paddingX={1}>
          {title && <Text dimColor>━━━ {title} ━━━</Text>}
          {suggestions.map((s, i) => (
            <Box key={s.value}>
              <Text color={i === selectedIndex ? 'cyan' : 'gray'}>
                {i === selectedIndex ? '▸ ' : '  '}
              </Text>
              <Text color={i === selectedIndex ? 'cyan' : 'white'} bold={i === selectedIndex}>
                {s.label || s.value}
              </Text>
              {s.desc && <Text dimColor> - {s.desc}</Text>}
            </Box>
          ))}
          <Text dimColor>↑↓: navigate, Tab: fill, Enter: select</Text>
        </Box>
      )}

      {/* Input box */}
      <Box
        borderStyle="single"
        borderColor={disabled ? 'gray' : 'green'}
        paddingX={1}
      >
        <Text color="green" bold>❯ </Text>
        {disabled ? (
          <Text dimColor>{placeholder}</Text>
        ) : (
          <TextInput
            value={value}
            onChange={onChange}
            onSubmit={handleSubmit}
            placeholder={placeholder}
          />
        )}
      </Box>
    </Box>
  );
};
