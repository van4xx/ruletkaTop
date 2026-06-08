import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/models.dart';
import '../data/profile_repository.dart';
import '../domain/received_gift.dart';

/// ─────────────────────────────────────────────────────────────────────────
/// Profile providers.
///
/// Family providers keyed by user id back both `/profile/:id` and
/// `/profile/me` (the latter resolves the id via the session first). Each is
/// `autoDispose` so navigating away frees the cached profile/gifts.
/// ─────────────────────────────────────────────────────────────────────────

/// A public profile by id.
final profileProvider =
    FutureProvider.autoDispose.family<PublicProfile, String>((ref, id) {
  return ref.watch(profileRepositoryProvider).profile(id);
});

/// The caller's own profile (used by `/profile/me`).
final myProfileDetailProvider =
    FutureProvider.autoDispose<PublicProfile>((ref) {
  return ref.watch(profileRepositoryProvider).myProfile();
});

/// The shared gift catalog (cached; used to resolve received gifts' metadata).
final giftCatalogProvider = FutureProvider<List<Gift>>((ref) {
  return ref.watch(profileRepositoryProvider).giftCatalog();
});

/// The cover catalogue (`GET /covers`) — cached for the picker.
final coverCatalogProvider = FutureProvider<List<ProfileCover>>((ref) {
  return ref.watch(profileRepositoryProvider).covers();
});

/// The caller's cover inventory (`GET /covers/me`) — active + owned ids.
final coverInventoryProvider =
    FutureProvider.autoDispose<CoverInventory>((ref) {
  return ref.watch(profileRepositoryProvider).myCovers();
});

/// The aggregated received-gifts showcase for a profile. Joins the user's
/// received-gift transactions with the catalog. While the catalog loads the
/// tiles fall back to placeholder titles so the section still renders.
final giftShowcaseProvider =
    FutureProvider.autoDispose.family<GiftShowcase, String>((ref, id) async {
  final repo = ref.watch(profileRepositoryProvider);
  final received = await repo.gifts(id);
  if (received.isEmpty) return GiftShowcase.empty;
  // The catalog is best-effort: if it fails we still aggregate using each
  // transaction's recorded price.
  final catalog = await ref.watch(giftCatalogProvider.future).catchError(
        (_) => <Gift>[],
      );
  return GiftShowcase.build(received, catalog);
});

/// Outcome of a one-shot profile action (friend request / report / block),
/// surfaced to the UI for a snackbar + optimistic state change.
enum ProfileActionStatus { idle, busy, success, error }

class ProfileActionState {
  const ProfileActionState({
    this.status = ProfileActionStatus.idle,
    this.message,
    this.blocked = false,
    this.friendRequested = false,
  });

  final ProfileActionStatus status;
  final String? message;

  /// True once this profile has been blocked (the screen swaps to a blocked
  /// state).
  final bool blocked;

  /// True once a friend request has been sent (the button becomes "Заявка
  /// отправлена").
  final bool friendRequested;

  bool get isBusy => status == ProfileActionStatus.busy;

  ProfileActionState copyWith({
    ProfileActionStatus? status,
    String? message,
    bool? blocked,
    bool? friendRequested,
    bool clearMessage = false,
  }) =>
      ProfileActionState(
        status: status ?? this.status,
        message: clearMessage ? null : (message ?? this.message),
        blocked: blocked ?? this.blocked,
        friendRequested: friendRequested ?? this.friendRequested,
      );
}

/// Controls the moderation/social actions on a profile (family-keyed by the
/// target user id), funnelling each through the [ProfileRepository] and
/// reflecting success/error into [ProfileActionState].
class ProfileActionController
    extends Notifier<ProfileActionState> {
  /// Riverpod 3.x family notifiers receive their family key (the target user
  /// id) via the constructor; `build()` is parameterless.
  ProfileActionController(this._userId);

  final String _userId;

  ProfileRepository get _repo => ref.read(profileRepositoryProvider);

  @override
  ProfileActionState build() => const ProfileActionState();

  /// Send a friend request to this user.
  Future<void> addFriend() async {
    if (state.isBusy || state.friendRequested) return;
    state = state.copyWith(status: ProfileActionStatus.busy, clearMessage: true);
    try {
      await _repo.sendFriendRequest(_userId);
      state = state.copyWith(
        status: ProfileActionStatus.success,
        friendRequested: true,
        message: 'Заявка отправлена',
      );
    } catch (e) {
      state = state.copyWith(
        status: ProfileActionStatus.error,
        message: _errorMessage(e, 'Не удалось отправить заявку'),
      );
    }
  }

  /// Report this user with the given [reason] + optional [details].
  Future<void> report(ReportReason reason, {String? details}) async {
    if (state.isBusy) return;
    state = state.copyWith(status: ProfileActionStatus.busy, clearMessage: true);
    try {
      await _repo.report(CreateReportDto(
        againstUserId: _userId,
        reason: reason,
        details: details,
      ));
      state = state.copyWith(
        status: ProfileActionStatus.success,
        message: 'Жалоба отправлена',
      );
    } catch (e) {
      state = state.copyWith(
        status: ProfileActionStatus.error,
        message: _errorMessage(e, 'Не удалось отправить жалобу'),
      );
    }
  }

  /// Block this user; on success the screen switches to a blocked state.
  Future<void> block() async {
    if (state.isBusy) return;
    state = state.copyWith(status: ProfileActionStatus.busy, clearMessage: true);
    try {
      await _repo.block(_userId);
      state = state.copyWith(
        status: ProfileActionStatus.success,
        blocked: true,
        message: 'Пользователь заблокирован',
      );
    } catch (e) {
      state = state.copyWith(
        status: ProfileActionStatus.error,
        message: _errorMessage(e, 'Не удалось заблокировать'),
      );
    }
  }

  /// Clear the surfaced message after the UI has shown it.
  void consumeMessage() {
    if (state.message != null) {
      state = state.copyWith(clearMessage: true, status: ProfileActionStatus.idle);
    }
  }

  static String _errorMessage(Object e, String fallback) {
    // ApiException carries a server-provided, Russian-first message.
    final msg = (e as dynamic).message;
    return msg is String && msg.isNotEmpty ? msg : fallback;
  }
}

final profileActionProvider = NotifierProvider.autoDispose.family<
    ProfileActionController, ProfileActionState, String>(
  ProfileActionController.new,
);

/// Result of saving an own-profile edit.
enum ProfileEditStatus { idle, saving, saved, error }

class ProfileEditState {
  const ProfileEditState({this.status = ProfileEditStatus.idle, this.message});

  final ProfileEditStatus status;
  final String? message;

  bool get isSaving => status == ProfileEditStatus.saving;
}

/// Saves own-profile edits (`PATCH /profiles/me`). Returns the updated profile
/// on success so the screen can refresh its caches.
class ProfileEditController extends Notifier<ProfileEditState> {
  ProfileRepository get _repo => ref.read(profileRepositoryProvider);

  @override
  ProfileEditState build() => const ProfileEditState();

  /// Submit only the changed fields ([dto]). Returns the updated profile, or
  /// `null` on failure (with [ProfileEditState.message] set).
  Future<PublicProfile?> save(UpdateProfileDto dto) async {
    state = const ProfileEditState(status: ProfileEditStatus.saving);
    try {
      final updated = await _repo.updateProfile(dto);
      state = const ProfileEditState(
          status: ProfileEditStatus.saved, message: 'Профиль обновлён');
      return updated;
    } catch (e) {
      final raw = (e as dynamic).message;
      final message = raw is String && raw.isNotEmpty
          ? raw
          : 'Не удалось сохранить изменения';
      state = ProfileEditState(status: ProfileEditStatus.error, message: message);
      return null;
    }
  }
}

final profileEditProvider =
    NotifierProvider.autoDispose<ProfileEditController, ProfileEditState>(
  ProfileEditController.new,
);

/// Drives cover purchase + activation from the picker. Busy while a coin debit
/// (purchase) or an activation round-trip is in flight; surfaces a message for
/// the UI. On success it refreshes the inventory + own-profile caches so the
/// hero + picker reflect the change.
enum CoverActionStatus { idle, busy, success, error }

class CoverActionState {
  const CoverActionState({this.status = CoverActionStatus.idle, this.message});

  final CoverActionStatus status;
  final String? message;

  bool get isBusy => status == CoverActionStatus.busy;
}

class CoverActionController extends Notifier<CoverActionState> {
  ProfileRepository get _repo => ref.read(profileRepositoryProvider);

  @override
  CoverActionState build() => const CoverActionState();

  /// Activate an already-owned (or free) cover. Returns `true` on success.
  Future<bool> activate(String coverId) =>
      _run(() => _repo.setActiveCover(coverId), 'Обложка применена');

  /// Buy a paid cover (debits coins, auto-activates). Returns `true` on success.
  Future<bool> purchase(String coverId) => _run(
        () => _repo.purchaseCover(coverId),
        'Обложка куплена и применена',
      );

  Future<bool> _run(Future<Object> Function() action, String okMessage) async {
    if (state.isBusy) return false;
    state = const CoverActionState(status: CoverActionStatus.busy);
    try {
      await action();
      // Refresh the inventory + own-profile so the hero + picker update.
      ref.invalidate(coverInventoryProvider);
      ref.invalidate(myProfileDetailProvider);
      state = CoverActionState(
          status: CoverActionStatus.success, message: okMessage);
      return true;
    } catch (e) {
      final raw = (e as dynamic).message;
      state = CoverActionState(
        status: CoverActionStatus.error,
        message: raw is String && raw.isNotEmpty
            ? raw
            : 'Не удалось изменить обложку',
      );
      return false;
    }
  }
}

final coverActionProvider =
    NotifierProvider.autoDispose<CoverActionController, CoverActionState>(
  CoverActionController.new,
);

/// Drives avatar upload + reset (`POST`/`DELETE /profiles/me/avatar`). Busy
/// while the multipart upload (or reset) is in flight; surfaces a message and
/// refreshes the own-profile caches so the hero + settings reflect the change.
enum AvatarActionStatus { idle, busy, success, error }

class AvatarActionState {
  const AvatarActionState({this.status = AvatarActionStatus.idle, this.message});

  final AvatarActionStatus status;
  final String? message;

  bool get isBusy => status == AvatarActionStatus.busy;
}

class AvatarActionController extends Notifier<AvatarActionState> {
  ProfileRepository get _repo => ref.read(profileRepositoryProvider);

  @override
  AvatarActionState build() => const AvatarActionState();

  /// Upload new avatar [bytes] (re-encoded server-side). Returns `true` on
  /// success.
  Future<bool> upload(
    List<int> bytes, {
    required String filename,
    String? mimeType,
  }) =>
      _run(
        () => _repo.uploadAvatar(bytes, filename: filename, mimeType: mimeType),
        'Аватар обновлён',
      );

  /// Reset the avatar to the default. Returns `true` on success.
  Future<bool> remove() =>
      _run(() => _repo.deleteAvatar(), 'Аватар сброшен');

  Future<bool> _run(
    Future<PublicProfile> Function() action,
    String okMessage,
  ) async {
    if (state.isBusy) return false;
    state = const AvatarActionState(status: AvatarActionStatus.busy);
    try {
      await action();
      ref.invalidate(myProfileDetailProvider);
      state = AvatarActionState(
          status: AvatarActionStatus.success, message: okMessage);
      return true;
    } catch (e) {
      final raw = (e as dynamic).message;
      state = AvatarActionState(
        status: AvatarActionStatus.error,
        message: raw is String && raw.isNotEmpty
            ? raw
            : 'Не удалось обновить аватар',
      );
      return false;
    }
  }
}

final avatarActionProvider =
    NotifierProvider.autoDispose<AvatarActionController, AvatarActionState>(
  AvatarActionController.new,
);
