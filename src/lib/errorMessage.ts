import { ApiError } from '../api/errors';

export function errorMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message : 'Не удалось выполнить запрос. Попробуйте ещё раз.';
  return error instanceof ApiError && error.requestId
    ? `${message} Код обращения: ${error.requestId}`
    : message;
}
