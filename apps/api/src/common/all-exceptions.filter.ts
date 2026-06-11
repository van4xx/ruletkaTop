import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { SentryExceptionCaptured } from '@sentry/nestjs';
import type { Request, Response } from 'express';

import type { ApiError } from '@ruletka/shared-types';

import { reportAlert } from '../observability/alerting/alerting.bridge';

/**
 * Global exception filter that normalises every thrown error into the shared
 * {@link ApiError} response contract, so clients can rely on a single error
 * shape regardless of the failure origin (validation, auth, domain, unknown).
 *
 * - {@link HttpException}s preserve their status and message.
 * - Anything else becomes a `500` with a generic message (details are logged,
 *   never leaked to the client).
 *
 * The `@SentryExceptionCaptured()` decorator reports the exception to Sentry
 * BEFORE we build the response, so app errors are captured AND still return the
 * normal shape. Per the official @sentry/nestjs guidance, this is the correct
 * integration when a custom catch-all filter already exists — we therefore do
 * NOT also register `SentryGlobalFilter` (using both would double-report). It is
 * a safe no-op when Sentry was not initialised (no `SENTRY_DSN`):
 * `Sentry.captureException` simply does nothing without an active client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  @SentryExceptionCaptured()
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, message, error } = this.normalise(exception);

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Log the full error server-side; the client only sees a generic body.
      this.logger.error(
        `${request.method} ${request.url} → ${statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      // Fan-out to the Telegram alerting pipeline. `reportAlert` is fail-safe:
      // it no-ops when the alerting module hasn't booted yet AND when
      // TELEGRAM_BOT_TOKEN is unset, so dev/CI stay quiet. The bridge swallows
      // all errors so a Telegram outage cannot corrupt the response we are
      // currently building.
      const requestId =
        (request.headers['x-request-id'] as string | undefined) ??
        (request as Request & { id?: string }).id;
      reportAlert({
        category: 'api-fatal',
        title: `${request.method} ${request.url} → ${statusCode}`,
        source: 'AllExceptionsFilter',
        message:
          exception instanceof Error
            ? `${exception.name}: ${exception.message}\n${exception.stack ?? ''}`
            : String(exception),
        requestId,
      });
    }

    const body: ApiError = { statusCode, message, error };
    response.status(statusCode).json(body);
  }

  private normalise(exception: unknown): Required<ApiError> {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();

      // Nest puts either a string or an object on the response. When it is an
      // object it frequently already matches ApiError (e.g. from the Zod pipe
      // or the built-in ValidationPipe) — reuse its message/error fields.
      if (typeof res === 'string') {
        return { statusCode: status, message: res, error: exception.name };
      }
      const obj = res as Record<string, unknown>;
      const message = (obj.message as string | string[]) ?? exception.message;
      const error = (obj.error as string) ?? exception.name;
      return { statusCode: status, message, error };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'Internal Server Error',
    };
  }
}
