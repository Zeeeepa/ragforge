import React from 'react';
import { Box, Text } from 'ink';

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

interface TodoListProps {
  todos: TodoItem[];
}

export const TodoList: React.FC<TodoListProps> = ({ todos }) => {
  if (todos.length === 0) return null;

  return (
    <Box flexDirection="column" paddingX={1} marginBottom={1}>
      <Text bold dimColor>Todos</Text>
      {todos.map((todo, i) => {
        let icon: string;
        let color: string;

        switch (todo.status) {
          case 'completed':
            icon = '☑';
            color = 'green';
            break;
          case 'in_progress':
            icon = '◐';
            color = 'yellow';
            break;
          default:
            icon = '☐';
            color = 'gray';
        }

        return (
          <Box key={i}>
            <Text color={color}>{icon} </Text>
            <Text color={todo.status === 'completed' ? 'gray' : 'white'} strikethrough={todo.status === 'completed'}>
              {todo.content}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};
