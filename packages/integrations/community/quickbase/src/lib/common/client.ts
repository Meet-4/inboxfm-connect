import {
  httpClient,
  HttpMethod,
  HttpRequest,
} from '@inboxfm-connect/pieces-common';
import { QuickbaseApiError } from './types';

// Only idempotent methods are safe to retry on a 5xx: the request may have
// been applied before the server errored, so re-sending a POST could create
// the record twice. 429 is always safe — the request was rejected before
// processing.
const IDEMPOTENT_METHODS: readonly HttpMethod[] = [
  HttpMethod.GET,
  HttpMethod.HEAD,
  HttpMethod.PUT,
  HttpMethod.DELETE,
];

export class QuickbaseClient {
  private readonly baseUrl = 'https://api.quickbase.com/v1';
  private readonly userToken: string;
  private readonly realmHostname: string;

  constructor(realmHostname: string, userToken: string) {
    this.realmHostname = realmHostname;
    this.userToken = userToken;
  }

  private async makeRequest<T>(
    endpoint: string,
    method: HttpMethod,
    data?: any
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const request: HttpRequest = {
      method,
      url,
      headers: {
        'QB-Realm-Hostname': this.realmHostname,
        'Authorization': `QB-USER-TOKEN ${this.userToken}`,
        'Content-Type': 'application/json',
      },
      body: data ? data : undefined,
    };

    let lastError: Error;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await httpClient.sendRequest<T>(request);
        return response.body;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // httpClient never resolves a non-2xx response — it throws HttpError,
        // whose `response` getter exposes { status, body }. All 429/5xx/4xx
        // handling therefore runs here, keyed on the error's status.
        const errorAny = error as {
          response?: {
            status?: number;
            body?: unknown;
            headers?: Record<string, string | string[]>;
          };
        };
        const errorResponse = errorAny?.response;
        const status = errorResponse?.status;

        if (status === 429) {
          // Rate-limited: the request was rejected before processing, so
          // retrying any method is safe. Honor Retry-After when the error
          // response carries it (HttpError does not expose headers today, so
          // this falls back to exponential backoff).
          if (attempt === 3) {
            throw lastError;
          }
          const retryAfter = errorResponse?.headers?.['retry-after'];
          const retryAfterValue = Array.isArray(retryAfter)
            ? retryAfter[0]
            : retryAfter;
          const delay = retryAfterValue
            ? parseInt(retryAfterValue) * 1000
            : Math.pow(2, attempt) * 1000;
          await this.sleep(delay);
          continue;
        }

        if (status !== undefined && status >= 500) {
          // A 5xx does not guarantee the request wasn't applied, so only
          // idempotent methods retry — a retried POST /records could
          // duplicate the record.
          if (attempt === 3 || !IDEMPOTENT_METHODS.includes(method)) {
            throw new Error(`Server error: ${status}`);
          }
          await this.sleep(Math.pow(2, attempt) * 1000);
          continue;
        }

        if (status !== undefined && status >= 400) {
          let errorMessage = `HTTP ${status}`;

          try {
            const errorData = errorResponse?.body as
              | QuickbaseApiError
              | undefined;
            if (errorData?.errors && errorData.errors.length > 0) {
              errorMessage = errorData.errors[0].message;
              if (errorData.errors[0].description) {
                errorMessage += ` - ${errorData.errors[0].description}`;
              }
            }
          } catch {
            errorMessage = errorResponse?.body
              ? String(errorResponse.body)
              : errorMessage;
          }

          throw new Error(errorMessage);
        }

        // Not an HTTP error (e.g. a network-level failure): retry only when
        // the message mentions 'network'.
        if (attempt === 3 || !this.isRetryableError(error)) {
          throw lastError;
        }

        await this.sleep(Math.pow(2, attempt) * 1000);
      }
    }

    throw lastError!;
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error && error.message.includes('network')) {
      return true;
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.makeRequest<T>(endpoint, HttpMethod.GET);
  }

  async post<T>(endpoint: string, data?: any): Promise<T> {
    return this.makeRequest<T>(endpoint, HttpMethod.POST, data);
  }

  async patch<T>(endpoint: string, data: any): Promise<T> {
    return this.makeRequest<T>(endpoint, HttpMethod.PATCH, data);
  }

  async delete<T>(endpoint: string, data?: any): Promise<T> {
    return this.makeRequest<T>(endpoint, HttpMethod.DELETE, data);
  }
}
