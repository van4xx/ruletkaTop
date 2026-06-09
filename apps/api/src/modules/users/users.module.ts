import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  CloudPaymentsCancelPort,
  PAYMENTS_CANCEL_PORT,
} from '../../common/payments-cancel.port';
import { CloudPaymentsClient } from '../payments/cloudpayments.client';
import { AvatarStorageService } from '../profiles/avatar-storage.service';
import { User, UserSchema } from './schemas/user.schema';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Owns the `users` collection (credentials, role, ban state, consent audit).
 *
 * Exports {@link UsersService} so cross-group modules (auth, social, economy,
 * moderation) can resolve accounts by id/email and create them during
 * registration. Registers the `User` schema for this module only. Exposes the
 * authenticated account-erasure endpoint (`DELETE /users/me`) via
 * {@link UsersController}.
 */
@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  controllers: [UsersController],
  providers: [
    UsersService,
    // Account-teardown's best-effort upstream billing cancel. The port + its
    // CloudPayments client depend only on the global ConfigService, so they are
    // provided LOCALLY (no PaymentsModule import / DI cycle); when CloudPayments
    // is unconfigured the port no-ops and only the LOCAL terminal-state drive runs.
    CloudPaymentsClient,
    { provide: PAYMENTS_CANCEL_PORT, useClass: CloudPaymentsCancelPort },
    // Used by {@link UsersService.eraseAccount} to fs.unlink the user's avatar
    // FILE on disk during right-to-be-forgotten. The service depends ONLY on the
    // global ConfigService (no DB/state), so it is provided LOCALLY here rather
    // than importing ProfilesModule (which imports back into this graph — would
    // risk a DI cycle), mirroring the local CloudPaymentsClient provision above.
    AvatarStorageService,
  ],
  exports: [UsersService, MongooseModule],
})
export class UsersModule {}
