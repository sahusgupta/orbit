export const AUTH_ACTION_TIMEOUT_MS = 10_000;

export class OperationTimeoutError extends Error {
  readonly code = 'orbit/operation-timeout';

  constructor(message: string) {
    super(message);
    this.name = 'OperationTimeoutError';
  }
}

export function isOperationTimeoutError(error: unknown): error is OperationTimeoutError {
  return error instanceof OperationTimeoutError || (
    error !== null &&
    typeof error === 'object' &&
    Reflect.get(error, 'code') === 'orbit/operation-timeout'
  );
}

export async function withDeadline<T>(
  operation: PromiseLike<T>,
  message: string,
  timeoutMs = AUTH_ACTION_TIMEOUT_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new OperationTimeoutError(message)), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve(operation), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
