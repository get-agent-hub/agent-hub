import type http from 'node:http';
export class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function jsonBody(
  req: http.IncomingMessage,
  limit = 16 * 1024,
): Promise<Record<string, unknown>> {
  if (req.headers['content-type'] !== 'application/json')
    throw new RequestError(415, 'Expected application/json.');
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > limit) throw new RequestError(413, 'Request is too large.');
  }
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new RequestError(400, 'Invalid JSON request.');
  }
}

export interface UiRequest {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  json: (code: number, data: unknown) => void;
}
export type UiRoute = (request: UiRequest) => Promise<boolean>;
