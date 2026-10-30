import { BaseHttpClient } from './base-http-client';
import { DelegatingAuthenticationConverter } from './delegating-authentication-converter';
import { HttpError } from './http-error';
import { HttpHeaders } from './http-headers';
import { HttpMessageBody } from './http-message-body';
import { HttpRequest } from './http-request';
import { HttpRequestBody } from './http-request-body';
import { HttpResponse } from './http-response';

// Native-fetch implementation of HttpClient. SSRF egress is enforced by the engine's
// in-process dns.lookup / Socket.connect guards (see ssrf-guard.ts) when
// AP_NETWORK_MODE=STRICT, which cover fetch via net.connect — so there is no egress
// proxy wiring here. A caller may still pass options.dispatcher for a user-configured
// per-request proxy (the HTTP piece's "Use Proxy" feature).
export class FetchHttpClient extends BaseHttpClient {
  constructor(
    baseUrl = '',
    authenticationConverter: DelegatingAuthenticationConverter = new DelegatingAuthenticationConverter()
  ) {
    super(baseUrl, authenticationConverter);
  }

  async sendRequest<ResponseBody extends HttpMessageBody = any>(
    request: HttpRequest<HttpRequestBody>,
    options?: SendRequestOptions
  ): Promise<HttpResponse<ResponseBody>> {
    const { urlWithoutQueryParams, queryParams: urlQueryParams } = this.getUrl(request);
    const headers = this.getHeaders(request);
    const queryParams = request.queryParams ?? {};
    for (const [key, value] of Object.entries(queryParams)) {
      // An undefined entry means "no value" — the same convention the client
      // already applies to headers. Appending it would send a literal
      // "undefined" parameter (and duplicate keys present in the URL string).
      if (value === undefined) {
        continue;
      }
      urlQueryParams.append(key, value);
    }
    const queryString = urlQueryParams.toString();
    const finalUrl = queryString ? `${urlWithoutQueryParams}?${queryString}` : urlWithoutQueryParams;

    const responseType = request.responseType ?? 'json';
    const followRedirects = request.followRedirects ?? true;
    const retries = request.retries ?? 0;

    const { body, extraHeaders, isStream } = serializeBody(request.body, headers);
    const finalHeaders = normalizeHeaders({ ...headers, ...extraHeaders });

    // The timeout budget must cover the FULL exchange: fetch() resolves as soon
    // as response *headers* arrive, so the abort timer may only be disarmed
    // once the body has been fully read (see parseResponseBody below). Clearing
    // it right after fetch() would leave body reads unbounded — a server that
    // sends headers promptly and then stalls the body hangs the request forever.
    const attempt = await sendWithRetries(async () => {
      const controller = new AbortController();
      const timeoutId = request.timeout && request.timeout > 0
        ? setTimeout(() => controller.abort(), request.timeout)
        : undefined;
      try {
        const init: FetchInit = {
          method: request.method.toString(),
          headers: finalHeaders,
          body,
          redirect: followRedirects ? 'follow' : 'manual',
          signal: controller.signal,
        };
        if (isStream) {
          init.duplex = 'half';
        }
        // A caller-supplied undici Dispatcher (e.g. a ProxyAgent) for per-request proxying.
        if (options?.dispatcher !== undefined) {
          init.dispatcher = options.dispatcher;
        }
        const response = await fetch(finalUrl, init);
        return { response, controller, timeoutId };
      } catch (error) {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        throw error;
      }
    }, retries);

    const successCeiling = followRedirects ? 300 : 400;
    try {
      if (attempt.response.status < 200 || attempt.response.status >= successCeiling) {
        const errorBody = await parseResponseBody(attempt.response, responseType, attempt.controller.signal);
        const httpError = new HttpError(request.body, { status: attempt.response.status, responseBody: errorBody });
        console.error('[HttpClient#(sanitized error message)] Request failed:', httpError);
        throw httpError;
      }

      const responseBody = await parseResponseBody(attempt.response, responseType, attempt.controller.signal);
      return {
        status: attempt.response.status,
        headers: toHttpHeaders(attempt.response.headers),
        body: responseBody as ResponseBody,
      };
    } finally {
      if (attempt.timeoutId !== undefined) {
        clearTimeout(attempt.timeoutId);
      }
    }
  }
}

function serializeBody(
  body: HttpRequestBody | undefined,
  headers: HttpHeaders
): { body: BodyInit | undefined; extraHeaders: Record<string, string>; isStream: boolean } {
  if (isNil(body)) {
    return { body: undefined, extraHeaders: {}, isStream: false };
  }
  // node `form-data` instance: a Readable stream that owns its multipart boundary.
  if (isNodeFormData(body)) {
    return { body: body as unknown as BodyInit, extraHeaders: body.getHeaders(), isStream: true };
  }
  // Already a wire-ready body — pass through untouched.
  if (
    typeof body === 'string' ||
    Buffer.isBuffer(body) ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer ||
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof Blob !== 'undefined' && body instanceof Blob)
  ) {
    return { body: body as BodyInit, extraHeaders: {}, isStream: false };
  }
  const contentType = headers['Content-Type'] ?? headers['content-type'] ?? '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return { body: new URLSearchParams(body as Record<string, string>).toString(), extraHeaders: {}, isStream: false };
  }
  return { body: JSON.stringify(body), extraHeaders: {}, isStream: false };
}

async function parseResponseBody(
  response: Response,
  responseType: ResponseType,
  signal?: AbortSignal
): Promise<unknown> {
  switch (responseType) {
    case 'arraybuffer':
      return Buffer.from(await readWithTimeout(response.arrayBuffer(), signal));
    case 'blob':
      return await readWithTimeout(response.blob(), signal);
    case 'text':
      return await readWithTimeout(response.text(), signal);
    case 'json':
    default: {
      const text = await readWithTimeout(response.text(), signal);
      if (text.length === 0) {
        return undefined;
      }
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
  }
}

// Races a body read against the request's abort signal. undici ties fetch
// response bodies to the signal natively, but bodies that are not (proxied
// dispatchers, plain Response objects) must still honor the deadline — a
// stalled body read rejects instead of hanging the request forever.
function readWithTimeout<T>(read: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) {
    return read;
  }
  if (signal.aborted) {
    return Promise.reject(bodyReadAbortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(bodyReadAbortError());
    signal.addEventListener('abort', onAbort, { once: true });
    read.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

function bodyReadAbortError(): Error {
  const error = new Error(
    'The request was aborted while reading the response body (request timeout exceeded).'
  );
  error.name = 'AbortError';
  return error;
}

type FetchAttempt = {
  response: Response;
  controller: AbortController;
  timeoutId: ReturnType<typeof setTimeout> | undefined;
};

async function sendWithRetries(fn: () => Promise<FetchAttempt>, retries: number): Promise<FetchAttempt> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await fn();
      if (result.response.status >= 500 && attempt < retries) {
        if (result.timeoutId !== undefined) {
          clearTimeout(result.timeoutId);
        }
        // Release the abandoned attempt: an undrained 5xx body keeps its socket
        // pinned in the connection pool until GC, and its abort timer must not
        // fire for an attempt nobody is reading anymore.
        await result.response.body?.cancel()?.catch(() => undefined);
        result.controller.abort();
        await backoff(attempt);
        continue;
      }
      return result;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await backoff(attempt);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

function backoff(attempt: number): Promise<void> {
  const delayMs = Math.min(1000 * 2 ** attempt, 30000);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function normalizeHeaders(headers: HttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    result[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return result;
}

function toHttpHeaders(headers: Headers): HttpHeaders {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function isNodeFormData(body: unknown): body is NodeFormData {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as NodeFormData).getHeaders === 'function' &&
    typeof (body as NodeFormData).pipe === 'function'
  );
}

function isNil(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

type NodeFormData = {
  getHeaders: () => Record<string, string>;
  pipe: (...args: unknown[]) => unknown;
};

type ResponseType = NonNullable<HttpRequest['responseType']>;

type FetchInit = RequestInit & { duplex?: 'half', dispatcher?: unknown };

export type SendRequestOptions = {
  dispatcher?: unknown;
};

export { FetchHttpClient as AxiosHttpClient };
