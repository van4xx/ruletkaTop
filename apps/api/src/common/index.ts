/**
 * Barrel for cross-cutting building blocks shared by every feature module:
 * the Zod validation pipe, the global exception filter, JWT auth scaffolding
 * and the `@CurrentUser()` decorator.
 */
export * from './zod-validation.pipe';
export * from './all-exceptions.filter';
export * from './current-user.decorator';
export * from './roles.decorator';
export * from './roles.guard';
export * from './jwt-auth.guard';
export * from './jwt.strategy';
export * from './jwt-payload.schema';
export * from './common.module';
