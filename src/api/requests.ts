import { attachmentPolicy, uploadMime } from '../lib/attachments';
import type { CartProposal } from './types';
import { ApiError } from './errors';

export function jsonRequest(body: unknown): RequestInit {
  const json = JSON.stringify(body);
  if (new TextEncoder().encode(json).length > 16_384)
    throw new ApiError(413, 'request_too_large', 'Сообщение слишком большое.');
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json };
}

export function chatRequest(sessionId: string, value: string): RequestInit {
  const message = value.trim();
  if (!message || [...message].length > 8_000)
    throw new Error('Напишите сообщение длиной от 1 до 8000 символов.');
  return jsonRequest({ session_id: sessionId, message });
}

export function confirmationRequest(sessionId: string, proposal: CartProposal): RequestInit {
  if (
    !Number.isInteger(proposal.quantity) ||
    proposal.quantity < 1 ||
    proposal.quantity > 2_147_483_647
  )
    throw new Error('Укажите целое количество от 1 до 2147483647.');
  if (!proposal.operation_id || !proposal.product_id)
    throw new Error('Запросите новое предложение для добавления товара.');
  return jsonRequest({
    session_id: sessionId,
    operation_id: proposal.operation_id,
    product_id: proposal.product_id,
    quantity: proposal.quantity,
  });
}

export function uploadRequest(file: File): RequestInit {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mime = uploadMime[extension];
  if (!mime) throw new ApiError(422, 'invalid_attachment', 'Неподдерживаемый формат файла.');
  if (file.size === 0) throw new Error('Выбранный файл пуст.');
  if (file.size > attachmentPolicy.maxSizeMb * 1024 * 1024)
    throw new ApiError(413, 'attachment_too_large', 'Файл слишком большой.');
  return {
    method: 'POST',
    headers: { 'Content-Type': mime, 'X-Filename': `attachment.${extension}` },
    body: file,
  };
}
