import { Global, Module } from '@nestjs/common';

import { MailerService } from './mailer.service';

/**
 * Provides the transactional {@link MailerService} (SMTP via nodemailer, with a
 * dev/CI no-op default — see the service doc).
 *
 * `@Global` so any module can inject `MailerService` without re-importing this
 * module (mirrors the project's other cross-cutting providers, e.g. metrics).
 * The service reads its SMTP/WEB_BASE_URL config from the global `ConfigModule`.
 */
@Global()
@Module({
  providers: [MailerService],
  exports: [MailerService],
})
export class MailModule {}
