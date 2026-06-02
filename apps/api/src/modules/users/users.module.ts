import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

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
  providers: [UsersService],
  exports: [UsersService, MongooseModule],
})
export class UsersModule {}
