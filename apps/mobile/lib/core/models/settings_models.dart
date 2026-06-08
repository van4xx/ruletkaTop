/// Mirrors `packages/shared-types/src/settings.ts`.
library;

import 'enums.dart';

/// `privacySettingsSchema`.
class PrivacySettings {
  const PrivacySettings({
    this.whoCanMessage = Visibility.everyone,
    this.whoCanCall = Visibility.friends,
    this.whoCanViewProfile = Visibility.everyone,
    this.showOnlineStatus = true,
  });

  final Visibility whoCanMessage;
  final Visibility whoCanCall;
  final Visibility whoCanViewProfile;
  final bool showOnlineStatus;

  factory PrivacySettings.fromJson(Map<String, dynamic> json) => PrivacySettings(
        whoCanMessage: Visibility.fromWire(json['whoCanMessage'] as String?),
        whoCanCall: Visibility.fromWire(json['whoCanCall'] as String?),
        whoCanViewProfile: Visibility.fromWire(json['whoCanViewProfile'] as String?),
        showOnlineStatus: json['showOnlineStatus'] as bool? ?? true,
      );

  Map<String, dynamic> toJson() => {
        'whoCanMessage': whoCanMessage.wire,
        'whoCanCall': whoCanCall.wire,
        'whoCanViewProfile': whoCanViewProfile.wire,
        'showOnlineStatus': showOnlineStatus,
      };

  PrivacySettings copyWith({
    Visibility? whoCanMessage,
    Visibility? whoCanCall,
    Visibility? whoCanViewProfile,
    bool? showOnlineStatus,
  }) =>
      PrivacySettings(
        whoCanMessage: whoCanMessage ?? this.whoCanMessage,
        whoCanCall: whoCanCall ?? this.whoCanCall,
        whoCanViewProfile: whoCanViewProfile ?? this.whoCanViewProfile,
        showOnlineStatus: showOnlineStatus ?? this.showOnlineStatus,
      );
}

/// `notificationSettingsSchema`.
class NotificationSettings {
  const NotificationSettings({
    this.pushEnabled = true,
    this.emailEnabled = false,
    this.friendRequests = true,
    this.messages = true,
    this.gifts = true,
  });

  final bool pushEnabled;
  final bool emailEnabled;
  final bool friendRequests;
  final bool messages;
  final bool gifts;

  factory NotificationSettings.fromJson(Map<String, dynamic> json) => NotificationSettings(
        pushEnabled: json['pushEnabled'] as bool? ?? true,
        emailEnabled: json['emailEnabled'] as bool? ?? false,
        friendRequests: json['friendRequests'] as bool? ?? true,
        messages: json['messages'] as bool? ?? true,
        gifts: json['gifts'] as bool? ?? true,
      );

  Map<String, dynamic> toJson() => {
        'pushEnabled': pushEnabled,
        'emailEnabled': emailEnabled,
        'friendRequests': friendRequests,
        'messages': messages,
        'gifts': gifts,
      };

  NotificationSettings copyWith({
    bool? pushEnabled,
    bool? emailEnabled,
    bool? friendRequests,
    bool? messages,
    bool? gifts,
  }) =>
      NotificationSettings(
        pushEnabled: pushEnabled ?? this.pushEnabled,
        emailEnabled: emailEnabled ?? this.emailEnabled,
        friendRequests: friendRequests ?? this.friendRequests,
        messages: messages ?? this.messages,
        gifts: gifts ?? this.gifts,
      );
}

/// `deviceSettingsSchema`.
class DeviceSettings {
  const DeviceSettings({this.preferredCameraId, this.preferredMicId});

  final String? preferredCameraId;
  final String? preferredMicId;

  factory DeviceSettings.fromJson(Map<String, dynamic> json) => DeviceSettings(
        preferredCameraId: json['preferredCameraId'] as String?,
        preferredMicId: json['preferredMicId'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'preferredCameraId': preferredCameraId,
        'preferredMicId': preferredMicId,
      };
}

/// `settingsSchema` — the full settings document.
class Settings {
  const Settings({
    this.privacy = const PrivacySettings(),
    this.notifications = const NotificationSettings(),
    this.devices = const DeviceSettings(),
    this.theme = AppThemeMode.system,
    this.locale = Locale.ru,
  });

  final PrivacySettings privacy;
  final NotificationSettings notifications;
  final DeviceSettings devices;
  final AppThemeMode theme;
  final Locale locale;

  factory Settings.fromJson(Map<String, dynamic> json) => Settings(
        privacy: PrivacySettings.fromJson(
            (json['privacy'] as Map<String, dynamic>?) ?? const {}),
        notifications: NotificationSettings.fromJson(
            (json['notifications'] as Map<String, dynamic>?) ?? const {}),
        devices:
            DeviceSettings.fromJson((json['devices'] as Map<String, dynamic>?) ?? const {}),
        theme: AppThemeMode.fromWire(json['theme'] as String?),
        locale: Locale.fromWire(json['locale'] as String?),
      );

  Map<String, dynamic> toJson() => {
        'privacy': privacy.toJson(),
        'notifications': notifications.toJson(),
        'devices': devices.toJson(),
        'theme': theme.wire,
        'locale': locale.wire,
      };

  Settings copyWith({
    PrivacySettings? privacy,
    NotificationSettings? notifications,
    DeviceSettings? devices,
    AppThemeMode? theme,
    Locale? locale,
  }) =>
      Settings(
        privacy: privacy ?? this.privacy,
        notifications: notifications ?? this.notifications,
        devices: devices ?? this.devices,
        theme: theme ?? this.theme,
        locale: locale ?? this.locale,
      );
}

/// `updateSettingsSchema` — a partial settings patch (PATCH /settings).
class UpdateSettingsDto {
  const UpdateSettingsDto({
    this.privacy,
    this.notifications,
    this.devices,
    this.theme,
    this.locale,
  });

  final PrivacySettings? privacy;
  final NotificationSettings? notifications;
  final DeviceSettings? devices;
  final AppThemeMode? theme;
  final Locale? locale;

  Map<String, dynamic> toJson() => {
        if (privacy != null) 'privacy': privacy!.toJson(),
        if (notifications != null) 'notifications': notifications!.toJson(),
        if (devices != null) 'devices': devices!.toJson(),
        if (theme != null) 'theme': theme!.wire,
        if (locale != null) 'locale': locale!.wire,
      };
}

/// `publicStatusSchema` — the UNAUTHENTICATED operational status served by
/// `GET /public/status` (mirrors `packages/shared-types/src/admin-panel.ts`).
///
/// Derived from the live, admin-toggleable flags (no env/secret is exposed).
/// The clients read it to surface a maintenance banner and to pre-disable the
/// register form / "start matching" action BEFORE the user hits the gated
/// endpoint — the server still enforces each gate (`403` on register,
/// `ws:error` on `mm:join`); this is purely a UX hint.
///
/// All three flags default to the "everything open" values so that a failed /
/// older response degrades to NOT nagging (no banner, registration allowed).
class PublicStatus {
  const PublicStatus({
    this.maintenanceMode = false,
    this.registrationOpen = true,
    this.matchmakingEnabled = true,
  });

  /// Platform is in maintenance — clients show a non-blocking banner.
  final bool maintenanceMode;

  /// New-account registration is open.
  final bool registrationOpen;

  /// The matchmaking/roulette pool is accepting joins.
  final bool matchmakingEnabled;

  factory PublicStatus.fromJson(Map<String, dynamic> json) => PublicStatus(
        maintenanceMode: json['maintenanceMode'] as bool? ?? false,
        registrationOpen: json['registrationOpen'] as bool? ?? true,
        matchmakingEnabled: json['matchmakingEnabled'] as bool? ?? true,
      );

  Map<String, dynamic> toJson() => {
        'maintenanceMode': maintenanceMode,
        'registrationOpen': registrationOpen,
        'matchmakingEnabled': matchmakingEnabled,
      };
}
