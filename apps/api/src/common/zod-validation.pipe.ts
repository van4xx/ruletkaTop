import {
  type ArgumentMetadata,
  HttpStatus,
  type PipeTransform,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ZodType } from 'zod';

import type { ApiError } from '@ruletka/shared-types';

/**
 * A Nest pipe that validates and parses an incoming value against a Zod schema
 * from `@ruletka/shared-types` (the single source of validation truth).
 *
 * On failure it throws `422 Unprocessable Entity` whose body matches the shared
 * {@link ApiError} contract — `message` is the array of human-readable issues.
 * On success it returns the PARSED value (so Zod coercions / defaults, e.g.
 * `paginationQuerySchema.limit`, are applied downstream).
 *
 * Usage (per-route, keeps the schema as the contract authority):
 * ```ts
 * @Post()
 * create(@Body(createZodValidationPipe(registerSchema)) dto: RegisterDto) { … }
 * ```
 */
export class ZodValidationPipe<TSchema extends ZodType> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (result.success) {
      return result.data;
    }

    // Flatten Zod issues into "path: message" strings for the ApiError body.
    const messages: string[] = result.error.issues.map((issue) => {
      const path = issue.path.join('.');
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
    });

    const body: ApiError = {
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      message: messages,
      error: 'Unprocessable Entity',
    };
    throw new UnprocessableEntityException(body);
  }
}

/**
 * Factory returning a ready-to-use {@link ZodValidationPipe} instance for the
 * given schema. Prefer this in route handlers so feature modules validate
 * against shared-types schemas without re-instantiating the class inline.
 */
export function createZodValidationPipe<TSchema extends ZodType>(
  schema: TSchema,
): ZodValidationPipe<TSchema> {
  return new ZodValidationPipe(schema);
}
