import type { IncomingMessage } from 'node:http';
import { ProxyError } from './errors.js';

export function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const declaredSize = Number(request.headers['content-length'] || 0);
  if (declaredSize > limit) {
    request.resume();
    return Promise.reject(new ProxyError(413, 'request_too_large', 'Превышен размер запроса.'));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      clearTimeout(timer);
      request.off('data', onData).off('end', onEnd).off('error', onError).off('aborted', onAborted);
    };
    const fail = (error: Error) => {
      cleanup();
      request.resume();
      reject(error);
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) fail(new ProxyError(413, 'request_too_large', 'Превышен размер запроса.'));
      else chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const onError = () =>
      fail(new ProxyError(400, 'invalid_request', 'Не удалось прочитать запрос.'));
    const onAborted = () =>
      fail(new ProxyError(400, 'invalid_request', 'Передача запроса прервана.'));
    const timer = setTimeout(
      () => fail(new ProxyError(408, 'request_timeout', 'Истекло время загрузки.')),
      120_000,
    );
    request.on('data', onData).once('end', onEnd).once('error', onError).once('aborted', onAborted);
  });
}
