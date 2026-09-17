// src/contexts/MessageContext.tsx
'use client';

import React, { createContext, useContext, useReducer, ReactNode } from 'react';

export type MessageTone = 'default' | 'error';

export interface GameMessage {
  text: string;
  /** Full dice/roll detail for the "verbose combat" view. Always recorded (when
   *  available) so toggling verbose re-renders history; only DISPLAY is gated. */
  verboseText?: string;
  tone: MessageTone;
}

type State = GameMessage[];

type Action =
  | { type: 'ADD_MESSAGE'; payload: GameMessage }
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
  addMessage: (msg: string, verboseText?: string) => void;
  addError: (msg: string, verboseText?: string) => void;
  clearMessages: () => void;
}

const MessageContext = createContext<MessageContextType | undefined>(undefined);

export const MessageProvider = ({ children }: { children: ReactNode }) => {
  const [messages, dispatch] = useReducer(messageReducer, []);

  const addMessage = (msg: string, verboseText?: string) =>
    dispatch({ type: 'ADD_MESSAGE', payload: { text: msg, ...(verboseText ? { verboseText } : {}), tone: 'default' } });
  const addError = (msg: string, verboseText?: string) =>
    dispatch({ type: 'ADD_MESSAGE', payload: { text: msg, ...(verboseText ? { verboseText } : {}), tone: 'error' } });
  const clearMessages = () => dispatch({ type: 'CLEAR_MESSAGES' });

  return (
    <MessageContext.Provider value={{ messages, addMessage, addError, clearMessages }}>
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