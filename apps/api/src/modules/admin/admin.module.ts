import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { PremiumModule } from '../premium/premium.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminAuditController } from './admin-audit.controller';
import { AdminBroadcastController } from './admin-broadcast.controller';
import { AdminBroadcastService } from './admin-broadcast.service';
import { AdminCallsController } from './admin-calls.controller';
import { AdminCallsService } from './admin-calls.service';
import { AdminContentController } from './admin-content.controller';
import { AdminContentService } from './admin-content.service';
import { AdminPaymentsController } from './admin-payments.controller';
import { AdminPaymentsService } from './admin-payments.service';
import { AdminPremiumController } from './admin-premium.controller';
import { AdminPremiumService } from './admin-premium.service';
import { AdminSecurityController } from './admin-security.controller';
import { AdminSecurityService } from './admin-security.service';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminSettingsService } from './admin-settings.service';
import { AdminWalletController } from './admin-wallet.controller';
import { AdminWalletService } from './admin-wallet.service';
import { AuditService } from './audit.service';
import { SettingsService } from './settings.service';
import { Announcement, AnnouncementSchema } from './schemas/announcement.schema';
import { AppSetting, AppSettingSchema } from './schemas/app-setting.schema';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';
import { BroadcastRecord, BroadcastRecordSchema } from './schemas/broadcast-record.schema';

/**
 * The expanded ADMIN-PANEL surface (admin.ruletka.top) — WAVE-1 scaffold.
 *
 * Owns the `admin_audit_logs` collection (plus the Wave-2 `announcements`,
 * `broadcasts` and `app_settings` collections) and the `/admin/{analytics,
 * wallet,premium,payments,calls,content,broadcast,security,settings,audit}` REST
 * surface. Every route reuses the SAME staff gate as the existing admin
 * controllers (class-level `JwtAuthGuard` + `RolesGuard` + `@Roles`); privileged
 * writes (wallet adjust, premium grant/revoke, broadcast, settings patch,
 * announcement create) narrow to `admin`-only and are recorded via
 * {@link AuditService}. The pre-existing ban/role/economy/users admin endpoints
 * stay in {@link ModerationModule} untouched.
 *
 * Wiring (no cycles — all leaf consumers):
 *  - {@link WalletModule} → real balance + atomic credit/debit (admin wallet);
 *  - {@link PremiumModule} → entitlement grant/revoke (admin premium);
 *  - {@link NotificationsModule} → broadcast fan-out (admin broadcast).
 * Everything else reads existing collections BY NAME via the shared Mongoose
 * connection (the established decoupled read pattern), so this module adds no
 * further import edges. `ConfigService` (global) backs the settings flags and
 * the shared ioredis client (global `RedisModule`) backs the online-count SCAN.
 *
 * {@link AuditService} is EXPORTED so the existing enforcement endpoints and
 * Wave-2 action endpoints can append to the trail.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
      // Wave-2 persistence: announcements, broadcast history, runtime settings.
      { name: Announcement.name, schema: AnnouncementSchema },
      { name: BroadcastRecord.name, schema: BroadcastRecordSchema },
      { name: AppSetting.name, schema: AppSettingSchema },
    ]),
    WalletModule,
    PremiumModule,
    NotificationsModule,
    // Authoritative refund path (CloudPayments call + ledger reversal).
    PaymentsModule,
  ],
  controllers: [
    AdminAnalyticsController,
    AdminWalletController,
    AdminPremiumController,
    AdminPaymentsController,
    AdminCallsController,
    AdminContentController,
    AdminBroadcastController,
    AdminSecurityController,
    AdminSettingsController,
    AdminAuditController,
  ],
  providers: [
    AuditService,
    SettingsService,
    AdminAnalyticsService,
    AdminWalletService,
    AdminPremiumService,
    AdminPaymentsService,
    AdminCallsService,
    AdminContentService,
    AdminBroadcastService,
    AdminSecurityService,
    AdminSettingsService,
  ],
  exports: [AuditService],
})
export class AdminModule {}
