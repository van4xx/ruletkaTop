import { HttpStatus, UnprocessableEntityException } from '@nestjs/common';

import type { ApiError } from '@ruletka/shared-types';

/**
 * Thrown when a {@link WalletService.debit} cannot proceed because the wallet's
 * balance is below the requested amount.
 *
 * Maps to `422 Unprocessable Entity` with the shared {@link ApiError} body so it
 * is indistinguishable from a validation failure at the HTTP boundary (the
 * request was well-formed but the business precondition — sufficient funds —
 * was not met).
 */
export class InsufficientFundsException extends UnprocessableEntityException {
  constructor(message = 'Insufficient coin balance') {
    const body: ApiError = {
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      message,
      error: 'Insufficient Funds',
    };
    super(body);
  }
}
