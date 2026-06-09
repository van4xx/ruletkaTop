import { ForbiddenException, HttpStatus } from '@nestjs/common';

import type { ApiError } from '@ruletka/shared-types';

/**
 * Thrown when a {@link WalletService.debit} spend is refused because the wallet
 * is under an ECONOMY HOLD: a refund/chargeback could not be fully reversed
 * (the buyer had already spent the credited coins), so the account is frozen
 * for spending until the outstanding `heldCoins` debt is repaid.
 *
 * Maps to `403 Forbidden` with the shared {@link ApiError} body — distinct from
 * {@link InsufficientFundsException} (422): the request was well-formed and the
 * balance may even suffice, but the account is administratively barred from
 * spending while it owes a reversed payment.
 */
export class EconomyHoldException extends ForbiddenException {
  constructor(message = 'Account is on hold for an unpaid refund and cannot spend coins') {
    const body: ApiError = {
      statusCode: HttpStatus.FORBIDDEN,
      message,
      error: 'Economy Hold',
    };
    super(body);
  }
}
