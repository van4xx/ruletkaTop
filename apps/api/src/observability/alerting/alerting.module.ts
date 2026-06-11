import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';

import { AlertingService } from './alerting.service';
import { setAlertingBridge } from './alerting.bridge';

/**
 * AlertingModule — global registration of {@link AlertingService}.
 *
 * Why global: the pino LoggerModule hook (configured at the root of
 * app.module.ts) needs to push `error`/`fatal` log records into the alerting
 * pipeline, and the AllExceptionsFilter (instantiated `new` in main.ts before
 * the container is built) reads it via the module-level bridge in
 * `alerting.bridge.ts`. Having the service `@Global()` lets any feature module
 * inject it directly (e.g. a queue worker reporting a poisoned job).
 *
 * Telegram credentials are read lazily inside the service's onModuleInit, so
 * this module is a pure pass-through wiring file.
 */
@Global()
@Module({
  providers: [AlertingService],
  exports: [AlertingService],
})
export class AlertingModule implements OnApplicationShutdown {
  constructor(private readonly alerting: AlertingService) {
    // Publish the service on the module-level bridge so the pino hook and the
    // pre-DI AllExceptionsFilter can reach it without a circular import.
    setAlertingBridge(alerting);
  }

  onApplicationShutdown(): void {
    // Cancel any pending throttle timers so the process can exit cleanly.
    this.alerting.shutdown();
    setAlertingBridge(null);
  }
}
