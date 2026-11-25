/**
 * Thrown by an outbox handler that waits for something expected (e.g. the welcome letter of a payment
 * notification): the outbox retries with backoff and logs it as `warn`, not as an error. Only the
 * last attempt is logged as an error, because then nothing will try again.
 */
export class RetryLaterError extends Error {
  override readonly name = 'RetryLaterError';
}
