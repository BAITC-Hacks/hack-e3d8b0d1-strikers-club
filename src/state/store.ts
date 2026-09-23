import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type {
  Analog,
  CartProposal,
  ExternalVariant,
  IdentifiedProduct,
  Product,
} from '../api/types';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  products?: Product[];
  analogs?: Analog[];
  external_variants?: ExternalVariant[];
  extracted?: IdentifiedProduct[];
  files?: string[];
  cartLink?: boolean;
  error?: boolean;
}

const chatSlice = createSlice({
  name: 'chat',
  initialState: {
    sessionId: '',
    messages: [] as Message[],
    proposal: null as CartProposal | null,
    unavailableProducts: [] as string[],
  },
  reducers: {
    addMessage: {
      reducer: (state, action: PayloadAction<Message>) => {
        state.messages.push(action.payload);
      },
      prepare: (message: Omit<Message, 'id'>) => ({
        payload: { ...message, id: crypto.randomUUID() },
      }),
    },
    sessionStarted: (state, action: PayloadAction<string>) => {
      state.sessionId = action.payload;
    },
    setProposal: (state, action: PayloadAction<CartProposal | null>) => {
      state.proposal = action.payload;
    },
    markProductUnavailable: (state, action: PayloadAction<string>) => {
      if (!state.unavailableProducts.includes(action.payload))
        state.unavailableProducts.push(action.payload);
    },
    newConversation: (state) => {
      state.sessionId = '';
      state.messages = [];
      state.proposal = null;
      state.unavailableProducts = [];
    },
  },
});

export const { addMessage, newConversation, sessionStarted, setProposal, markProductUnavailable } =
  chatSlice.actions;
export const chatReducer = chatSlice.reducer;
export function createAssistantStore() {
  const store = configureStore({ reducer: { chat: chatSlice.reducer } });
  return store;
}
export type AssistantStore = ReturnType<typeof createAssistantStore>;
export type RootState = ReturnType<AssistantStore['getState']>;
export type AppDispatch = AssistantStore['dispatch'];
