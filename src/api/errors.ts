const messages: Record<string, string> = {
  authentication_required: 'Сервис пока не настроен. Обратитесь к администратору сайта.',
  session_unauthorized: 'Доступ к диалогу потерян. Начните новый диалог.',
  session_not_found: 'Время диалога истекло. Временная корзина и предложения больше недоступны.',
  product_not_found: 'Товар больше не найден в каталоге. Попробуйте новый поиск.',
  session_busy: 'Дождитесь завершения текущего запроса.',
  cart_conflict: 'Предложение больше недействительно. Запросите новое добавление через чат.',
  request_too_large: 'Сообщение слишком большое. Сократите текст и повторите отправку.',
  attachment_too_large: 'Файл слишком большой. Выберите файл меньшего размера.',
  validation_error: 'Не удалось обработать запрос. Проверьте введённые данные.',
  invalid_attachment: 'Файл не прошёл проверку. Выберите другой файл или напишите артикул.',
  upstream_unavailable: 'Каталог или помощник временно недоступен. Попробуйте позже.',
  integration_not_configured: 'Эта функция пока не подключена на сервере.',
  upload_scanner_unavailable: 'Проверка файлов временно недоступна. Отправьте артикул текстом.',
  storage_unavailable: 'Хранилище диалогов временно недоступно. Попробуйте позже.',
  internal_error: 'На сервере произошла ошибка. Попробуйте позже.',
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null = null,
  ) {
    super(messages[code] ?? message);
    this.name = 'ApiError';
  }
}

export function isSessionError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    (error.code === 'session_not_found' || error.code === 'session_unauthorized')
  );
}

export function responseError(status: number, data: unknown, requestId: string | null): ApiError {
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const detail =
    record.error && typeof record.error === 'object'
      ? (record.error as Record<string, unknown>)
      : {};
  const code = typeof detail.code === 'string' ? detail.code : 'http_error';
  const message =
    typeof detail.message === 'string' && detail.message.trim()
      ? detail.message
      : `Сервис недоступен (HTTP ${status}). Попробуйте позже.`;
  return new ApiError(
    status,
    code,
    message,
    typeof record.request_id === 'string' ? record.request_id : requestId,
  );
}
