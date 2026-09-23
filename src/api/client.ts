import { createDemoApi } from './demo';
import { ApiError, isSessionError } from './errors';
import { createHttpClient } from './http';
import {
  normalizeCart,
  normalizeCartResult,
  normalizeChat,
  normalizeHealth,
  normalizeProduct,
  normalizeSession,
} from './normalize';
import { chatRequest, confirmationRequest, uploadRequest } from './requests';
import type { AssistantApi, SessionInfo } from './types';

export { normalizeProduct } from './normalize';
export { ApiError, isSessionError } from './errors';

type ApiOptions = { mode?: 'demo' | 'live'; baseUrl?: string };

export function createApi(options: ApiOptions = {}): AssistantApi {
  const mode = options.mode ?? (import.meta.env.VITE_API_MODE === 'demo' ? 'demo' : 'live');
  if (mode === 'demo') return createDemoApi();
  const baseUrl = (options.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? '/backend/api').replace(
    /\/$/,
    '',
  );
  const request = createHttpClient(baseUrl);
  let session: ReturnType<typeof normalizeSession> | null = null;
  let starting: Promise<SessionInfo> | null = null;
  let busy = false;

  async function exclusive<T>(sessionId: string, work: (token: string) => Promise<T>): Promise<T> {
    if (busy || starting) throw new ApiError(409, 'session_busy', 'Запрос уже выполняется.');
    if (!session || session.session_id !== sessionId)
      throw new ApiError(404, 'session_not_found', 'Сначала откройте новый диалог.');
    busy = true;
    try {
      return await work(session.session_token);
    } catch (error) {
      if (isSessionError(error)) session = null;
      throw error;
    } finally {
      busy = false;
    }
  }

  return {
    mode: 'live',
    start() {
      if (starting) return starting;
      if (busy) return Promise.reject(new ApiError(409, 'session_busy', 'Запрос уже выполняется.'));
      session = null;
      starting = (async () => {
        session = normalizeSession(await request('/chat/sessions', { method: 'POST' }));
        return { session_id: session.session_id, expires_in: session.expires_in };
      })().finally(() => {
        starting = null;
      });
      return starting;
    },
    chat(sessionId, message) {
      return exclusive(sessionId, async (token) =>
        normalizeChat(await request('/chat', chatRequest(sessionId, message), token)),
      );
    },
    upload(sessionId, file) {
      return exclusive(sessionId, async (token) =>
        normalizeChat(
          await request(
            `/chat/upload?session_id=${encodeURIComponent(sessionId)}`,
            uploadRequest(file),
            token,
          ),
        ),
      );
    },
    async product(id) {
      return normalizeProduct(await request(`/products/${encodeURIComponent(id)}`));
    },
    confirm(sessionId, proposal) {
      return exclusive(sessionId, async (token) =>
        normalizeCartResult(
          await request('/cart/items', confirmationRequest(sessionId, proposal), token),
        ),
      );
    },
    cart(sessionId) {
      return exclusive(sessionId, async (token) =>
        normalizeCart(
          await request(`/cart?session_id=${encodeURIComponent(sessionId)}`, {}, token),
        ),
      );
    },
    async health() {
      return normalizeHealth(await request('/health/ready'));
    },
  };
}
