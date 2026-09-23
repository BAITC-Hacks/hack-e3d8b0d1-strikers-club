import type { ServerResponse } from 'node:http';

export class ProxyError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function sendError(response: ServerResponse, error: ProxyError, requestId: string) {
  if (response.destroyed || response.writableEnded) return;
  response.statusCode = error.status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Request-ID', requestId);
  response.end(
    JSON.stringify({
      error: { code: error.code, message: error.message, details: [] },
      request_id: requestId,
    }),
  );
}
