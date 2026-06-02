import { z } from 'zod';

/**
 * Local RUNTIME re-declaration of the access-token payload schema.
 *
 * The API consumes `@ruletka/shared-types` with `import type` ONLY (so the
 * compiler emits no `require()` of that TS-source package — see the note in
 * tsconfig.json). The JWT strategy, however, needs to VALIDATE the decoded
 * token at runtime, which requires a real Zod value. We therefore re-declare
 * the schema here, kept structurally identical to `jwtPayloadSchema` /
 * `JwtPayload` in shared-types. If that contract changes, update this too.
 */
export const jwtPayloadSchema = z.object({
  /** User id (Mongo ObjectId hex string). */
  sub: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
  role: z.enum(['user', 'moderator', 'admin']),
  isPremium: z.boolean(),
});

/** Compile-time check that this matches the shared `JwtPayload` shape. */
export type LocalJwtPayload = z.infer<typeof jwtPayloadSchema>;
