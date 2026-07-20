// src/contexts/MessageContext.tsx
'use client';

import React, { createContext, useContext, useReducer, ReactNode } from 'react';

type Message = string;
type State = Message[];

type Action = 
  | { type: 'ADD_MESSAGE'; payload: string }
  | { type: 'CLEAR_MESSAGES' };

const messageReducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'ADD_MESSAGE':
      return [...state, action.payload];
    case 'CLEAR_MESSAGES':
      return [];
    default:
      return state;
  }
};

interface MessageContextType {
  messages: State;
  addMessage: (msg: string) => void;
  clearMessages: () => void;
}

const MessageContext = createContext<MessageContextType | undefined>(undefined);

export const MessageProvider = ({ children }: { children: ReactNode }) => {
  const [messages, dispatch] = useReducer(messageReducer, []);

  const addMessage = (msg: string) => dispatch({ type: 'ADD_MESSAGE', payload: msg });
  const clearMessages = () => dispatch({ type: 'CLEAR_MESSAGES' });

  return (
    <MessageContext.Provider value={{ messages, addMessage, clearMessages }}>
      {children}
    </MessageContext.Provider>
  );
};

export const useMessages = () => {
  const context = useContext(MessageContext);
  if (!context) {
    throw new Error('useMessages must be used within MessageProvider');
  }
  return context;
};