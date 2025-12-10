import React from 'react';
import { Box, Text } from 'ink';

interface StatusBarProps {
  text: string | null;
  isThinking?: boolean;
}

export const StatusBar: React.FC<StatusBarProps> = ({ text, isThinking }) => {
  if (!text && !isThinking) return null;

  const displayText = text || (isThinking ? 'Thinking...' : '');

  return (
    <Box paddingX={1} marginBottom={0}>
      <Text dimColor>
        ⏳ {displayText}
      </Text>
    </Box>
  );
};
