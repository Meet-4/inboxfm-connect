export class HttpError extends Error {
  private readonly status: number;
  private readonly responseBody: unknown;

  constructor(private readonly requestBody: unknown, params: HttpErrorParams) {
    const status = params.status || 500;
    const responseBody = Buffer.isBuffer(params.responseBody) ? params.responseBody.toString() : params.responseBody;

    // The message is a best-effort summary for logs; it must never crash the
    // constructor. Request bodies built in code (not parsed from JSON) can be
    // circular or otherwise unserializable — throwing "Converting circular
    // structure to JSON" here would replace the real HTTP failure with a
    // JSON.stringify TypeError and lose the status/body entirely.
    super(safeErrorSummary(status, responseBody, requestBody));

    this.status = status;
    this.responseBody = responseBody;
  }

  public errorMessage() {
    return {
      response: {
        status: this.status,
        body: this.responseBody,
      },
      request: {
        body: this.requestBody,
      },
    };
  }

  get response() {
    return {
      status: this.status,
      body: this.responseBody,
    };
  }

  get request() {
    return {
      body: this.requestBody,
    };
  }
}

export type HttpErrorParams = {
  status: number;
  responseBody: unknown;
};

function safeErrorSummary(
  status: number,
  responseBody: unknown,
  requestBody: unknown
): string {
  const summary = {
    response: {
      status: status,
      body: responseBody,
    },
    request: {
      body: requestBody,
    },
  };
  try {
    return JSON.stringify(summary);
  } catch {
    // Unserializable (e.g. circular) request body — keep the useful parts.
    return JSON.stringify({
      response: {
        status: status,
        body: responseBody,
      },
      request: {
        body: '[unserializable request body]',
      },
    });
  }
}
