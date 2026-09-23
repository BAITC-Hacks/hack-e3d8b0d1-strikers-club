import { describe, expect, it } from 'vitest';
import {
  addMessage,
  chatReducer,
  createAssistantStore,
  newConversation,
  sessionStarted,
} from './store';

describe('conversation state', () => {
  it('replays the same actions with identical IDs and state', () => {
    const start = newConversation();
    const message = addMessage({ role: 'user', text: 'Кабель' });
    const replay = () => chatReducer(chatReducer(undefined, start), message);
    expect(replay()).toEqual(replay());
    expect(replay().messages[0].id).toBe(message.payload.id);
  });

  it('keeps conversation data separate between widget instances', () => {
    const first = createAssistantStore();
    const second = createAssistantStore();
    first.dispatch(sessionStarted('server-session-one'));
    first.dispatch(addMessage({ role: 'user', text: 'Первый виджет' }));
    second.dispatch(newConversation());
    expect(first.getState().chat.messages).toHaveLength(1);
    expect(second.getState().chat.messages).toHaveLength(0);
    expect(first.getState().chat.sessionId).not.toBe(second.getState().chat.sessionId);
  });
});
