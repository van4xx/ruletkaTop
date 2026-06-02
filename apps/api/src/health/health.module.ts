import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';

/**
 * Exposes the `GET /health` readiness probe. Mongo connection and the shared
 * Redis client are injected from the globally-registered MongooseModule /
 * RedisModule, so no extra providers are needed here.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
