import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api.dart';
import '../../../core/di/di.dart';
import '../../../core/models/models.dart';

/// Data access for the profile feature: reading public profiles + received
/// gifts, editing the caller's own profile, and the moderation/social actions
/// surfaced on others' profiles (report / block / unblock / friend request).
/// Thin wrappers over the shared [ApiEndpoints] so the presentation layer never
/// touches paths directly.
class ProfileRepository {
  ProfileRepository(this._api);

  final ApiClient _api;

  /// `GET /profiles/:id`.
  Future<PublicProfile> profile(String id) => _api.profileById(id);

  /// The caller's own profile (`/auth/me` → `/profiles/:id`).
  Future<PublicProfile> myProfile() => _api.myProfile();

  /// `GET /profiles/:id/gifts` — gifts received by a user.
  Future<List<GiftTransaction>> gifts(String id) => _api.profileGifts(id);

  /// The gift catalog — used to resolve a received gift's title/animation/rarity
  /// (the `GiftTransaction` carries only ids + price).
  Future<List<Gift>> giftCatalog() => _api.gifts();

  /// `PATCH /profiles/me`.
  Future<PublicProfile> updateProfile(UpdateProfileDto dto) =>
      _api.updateProfile(dto);

  /// `POST /profiles/me/avatar` — upload (or replace) the caller's avatar.
  Future<PublicProfile> uploadAvatar(
    List<int> bytes, {
    required String filename,
    String? mimeType,
  }) =>
      _api.uploadAvatar(bytes, filename: filename, mimeType: mimeType);

  /// `DELETE /profiles/me/avatar` — reset the caller's avatar to the default.
  Future<PublicProfile> deleteAvatar() => _api.deleteAvatar();

  // ── Covers (profile cosmetics) ──
  /// `GET /covers` — the cover catalogue.
  Future<List<ProfileCover>> covers() => _api.covers();

  /// `GET /covers/me` — the caller's cover inventory.
  Future<CoverInventory> myCovers() => _api.myCovers();

  /// `POST /covers/purchase` — buy a cover (auto-activates).
  Future<CoverInventory> purchaseCover(String coverId) =>
      _api.purchaseCover(coverId);

  /// `POST /covers/active` — set the caller's active cover.
  Future<PublicProfile> setActiveCover(String coverId) =>
      _api.setActiveCover(coverId);

  /// `POST /friends/request`.
  Future<Friendship> sendFriendRequest(String recipientId) =>
      _api.sendFriendRequest(recipientId);

  /// `POST /reports`.
  Future<void> report(CreateReportDto dto) => _api.report(dto);

  /// `POST /blocks`.
  Future<void> block(String userId) => _api.block(userId);

  /// `DELETE /blocks/:id`.
  Future<void> unblock(String userId) => _api.unblock(userId);
}

/// Provides the [ProfileRepository] over the shared [apiClientProvider].
final profileRepositoryProvider = Provider<ProfileRepository>((ref) {
  return ProfileRepository(ref.watch(apiClientProvider));
});
