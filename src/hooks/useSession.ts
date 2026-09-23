import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AssistantApi } from '../api/types';
import { isSessionError } from '../api/errors';
import { errorMessage } from '../lib/errorMessage';
import { useAppDispatch, useAppSelector, useAppStore } from '../state/hooks';
import { newConversation, sessionStarted } from '../state/store';

export function useSession(api: AssistantApi) {
  const dispatch = useAppDispatch();
  const store = useAppStore();
  const cache = useQueryClient();
  const sessionId = useAppSelector((state) => state.chat.sessionId);
  const lock = useRef(false);
  const attempted = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const initialize = useCallback(async () => {
    const session = await api.start();
    dispatch(sessionStarted(session.session_id));
  }, [api, dispatch]);
  const clear = useCallback(() => {
    dispatch(newConversation());
    cache.removeQueries({ queryKey: ['cart'] });
  }, [dispatch, cache]);
  const start = useCallback(
    async (restart = false) => {
      if (lock.current || (!restart && store.getState().chat.sessionId)) return;
      attempted.current = true;
      lock.current = true;
      setPending(true);
      setError('');
      if (restart) {
        clear();
        setNotice('');
      }
      try {
        await initialize();
      } catch (error) {
        setError(errorMessage(error));
      } finally {
        lock.current = false;
        setPending(false);
      }
    },
    [initialize, clear, store],
  );
  const ensure = useCallback(() => {
    if (!attempted.current) void start();
  }, [start]);

  async function run<T>(work: (id: string) => Promise<T>): Promise<T> {
    const id = store.getState().chat.sessionId;
    if (lock.current) throw new Error('Дождитесь завершения текущего запроса.');
    if (!id) throw new Error('Сначала подключитесь к серверу.');
    lock.current = true;
    setPending(true);
    setError('');
    try {
      return await work(id);
    } catch (error) {
      if (isSessionError(error)) {
        clear();
        setNotice('Диалог истёк. История и временная корзина очищены. Начните новый запрос.');
        try {
          await initialize();
        } catch (recoveryError) {
          setError(errorMessage(recoveryError));
        }
      }
      throw error;
    } finally {
      lock.current = false;
      setPending(false);
    }
  }

  return {
    sessionId,
    ready: Boolean(sessionId),
    pending,
    error,
    notice,
    ensure,
    start,
    run,
    isCurrent: (id: string) => store.getState().chat.sessionId === id,
    clearNotice: () => setNotice(''),
  };
}
export type SessionController = ReturnType<typeof useSession>;
