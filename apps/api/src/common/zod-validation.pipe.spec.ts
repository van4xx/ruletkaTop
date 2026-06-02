import { UnprocessableEntityException } from '@nestjs/common';
import { z } from 'zod';

import type { ApiError } from '@ruletka/shared-types';

import { createZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const schema = z.object({
    email: z.string().email(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  });
  const meta = { type: 'body' as const, metatype: undefined, data: undefined };

  it('returns the parsed value (applying coercions/defaults) on success', () => {
    const pipe = createZodValidationPipe(schema);
    const result = pipe.transform({ email: 'a@b.com', limit: '5' }, meta);
    expect(result).toEqual({ email: 'a@b.com', limit: 5 });
  });

  it('applies schema defaults for omitted fields', () => {
    const pipe = createZodValidationPipe(schema);
    const result = pipe.transform({ email: 'a@b.com' }, meta);
    expect(result).toEqual({ email: 'a@b.com', limit: 20 });
  });

  it('throws 422 with the ApiError shape on failure', () => {
    const pipe = createZodValidationPipe(schema);
    expect.assertions(4);
    try {
      pipe.transform({ email: 'not-an-email' }, meta);
    } catch (err) {
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      const body = (err as UnprocessableEntityException).getResponse() as ApiError;
      expect(body.statusCode).toBe(422);
      expect(Array.isArray(body.message)).toBe(true);
      expect((body.message as string[])[0]).toContain('email');
    }
  });
});
