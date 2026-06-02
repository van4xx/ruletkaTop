import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api.dart';
import '../../../core/di/di.dart';
import '../../../core/models/models.dart';

/// Loads + caches the caller's [Settings] (`GET /settings`) and applies partial
/// updates (`PATCH /settings`). Backs every settings section so they share one
/// source of truth and re-render together after a save.
///
/// Exposed as an [AsyncNotifier] so screens can switch on
/// loading / error / data via [AsyncValue]. [patch] performs an optimistic
/// update (so toggles feel instant) and rolls back on failure.
class SettingsController extends AsyncNotifier<Settings> {
  ApiClient get _api => ref.read(apiClientProvider);

  @override
  Future<Settings> build() => _api.settings();

  /// Re-fetch from the server (used by retry / pull-to-refresh).
  Future<void> reload() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(() => _api.settings());
  }

  /// Apply a partial update. Optimistically patches local state, sends the
  /// PATCH, then reconciles with the server's canonical response. On failure
  /// the previous value is restored and the [ApiException] rethrown so the
  /// caller can surface a message (snackbar).
  Future<Settings> patch(UpdateSettingsDto dto) async {
    final previous = state.value;
    if (previous != null) {
      state = AsyncValue.data(_applyLocally(previous, dto));
    }
    try {
      final updated = await _api.updateSettings(dto);
      state = AsyncValue.data(updated);
      return updated;
    } catch (e) {
      if (previous != null) state = AsyncValue.data(previous);
      rethrow;
    }
  }

  /// Merge a [UpdateSettingsDto] into the current [Settings] for the optimistic
  /// step (mirrors the server's deep-merge of the partial sections).
  Settings _applyLocally(Settings current, UpdateSettingsDto dto) {
    return current.copyWith(
      privacy: dto.privacy != null
          ? current.privacy.copyWith(
              whoCanMessage: dto.privacy!.whoCanMessage,
              whoCanCall: dto.privacy!.whoCanCall,
              whoCanViewProfile: dto.privacy!.whoCanViewProfile,
              showOnlineStatus: dto.privacy!.showOnlineStatus,
            )
          : null,
      notifications: dto.notifications != null
          ? current.notifications.copyWith(
              pushEnabled: dto.notifications!.pushEnabled,
              emailEnabled: dto.notifications!.emailEnabled,
              friendRequests: dto.notifications!.friendRequests,
              messages: dto.notifications!.messages,
              gifts: dto.notifications!.gifts,
            )
          : null,
      devices: dto.devices,
      theme: dto.theme,
      locale: dto.locale,
    );
  }
}

/// The settings document controller + its observable [AsyncValue].
final settingsControllerProvider =
    AsyncNotifierProvider<SettingsController, Settings>(SettingsController.new);

/// ─────────────────────────────────────────────────────────────────────────
/// Appearance preferences (theme mode + locale).
///
/// `main.dart` is owned by the foundation and currently hard-codes
/// `themeMode: ThemeMode.dark`. These providers expose the user's *saved*
/// preference (sourced from the settings document) so the integrator can wire
/// them into `MaterialApp.router` — e.g.:
///
/// ```dart
/// final mode = ref.watch(themeModeProvider);
/// MaterialApp.router(themeMode: mode, ...);
/// ```
///
/// Until that wiring lands, the Appearance tab still persists the choice to the
/// server (so it syncs across devices and takes effect on web).
/// ─────────────────────────────────────────────────────────────────────────

/// The effective [ThemeMode] derived from the loaded settings (defaults to dark
/// — the hero theme — while loading or on error).
final themeModeProvider = Provider<ThemeMode>((ref) {
  final settings = ref.watch(settingsControllerProvider).value;
  return switch (settings?.theme ?? AppThemeMode.dark) {
    AppThemeMode.light => ThemeMode.light,
    AppThemeMode.dark => ThemeMode.dark,
    AppThemeMode.system => ThemeMode.system,
  };
});

/// The effective interface [Locale] preference derived from settings (defaults
/// to Russian — the product is Russian-first).
final preferredLocaleProvider = Provider<Locale>((ref) {
  final settings = ref.watch(settingsControllerProvider).value;
  return settings?.locale ?? Locale.ru;
});
