import 'package:dio/dio.dart';

import '../models/models.dart';
import 'api_client.dart';

/// Typed endpoint helpers over [ApiClient], grouped by domain and sourced from
/// the contract (`@ruletka/shared-types`) + the NestJS controllers under
/// `/api`. Feature agents call these instead of hand-rolling paths.
///
/// All routes are relative to the `/api` base (see [ApiConfig.baseUrl]). List
/// endpoints return a flat [Paginated] page (`{ items, nextCursor, hasMore }`).
extension ApiEndpoints on ApiClient {
  // ───────────────────────────────── Auth ─────────────────────────────────
  /// `POST /auth/register` — create an account (18+) and start a session.
  Future<AuthResponse> register(RegisterDto dto) => sendJson(
        'POST',
        '/auth/register',
        AuthResponse.fromJson,
        body: dto.toJson(),
        skipAuth: true,
      );

  /// `POST /auth/login`.
  Future<AuthResponse> login(LoginDto dto) => sendJson(
        'POST',
        '/auth/login',
        AuthResponse.fromJson,
        body: dto.toJson(),
        skipAuth: true,
      );

  /// `GET /auth/me` — the authenticated [AuthUser].
  Future<AuthUser> me() => getJson('/auth/me', AuthUser.fromJson);

  /// `POST /auth/logout` — revoke the refresh session. Sends the stored refresh
  /// token in the body (mobile has no cookie). Best-effort; ignores errors.
  Future<void> logout() async {
    final refresh = await tokens.readRefreshToken();
    await sendVoid(
      'POST',
      '/auth/logout',
      body: {'refreshToken': ?refresh},
    );
  }

  // ─────────────────────────────── Profiles ───────────────────────────────
  /// `GET /profiles/:id`.
  Future<PublicProfile> profileById(String id, {CancelToken? cancelToken}) =>
      getJson('/profiles/$id', PublicProfile.fromJson, cancelToken: cancelToken);

  /// The caller's own profile: resolve `/auth/me` → `/profiles/:id`.
  Future<PublicProfile> myProfile() async {
    final account = await me();
    return profileById(account.id);
  }

  /// `PATCH /profiles/me` — update the caller's profile.
  Future<PublicProfile> updateProfile(UpdateProfileDto dto) => sendJson(
        'PATCH',
        '/profiles/me',
        PublicProfile.fromJson,
        body: dto.toJson(),
      );

  /// `GET /profiles/search` — nickname-prefix discovery with optional facets.
  Future<Paginated<PublicProfile>> searchProfiles({
    String? q,
    Gender? gender,
    String? country,
    String? cursor,
    int? limit,
    CancelToken? cancelToken,
  }) =>
      getPage(
        '/profiles/search',
        PublicProfile.fromJson,
        cursor: cursor,
        limit: limit,
        extraQuery: {
          if (q != null && q.isNotEmpty) 'q': q,
          if (gender != null) 'gender': gender.wire,
          'country': ?country,
        },
        cancelToken: cancelToken,
      );

  /// `GET /profiles/:id/gifts` — gifts received by a user.
  Future<List<GiftTransaction>> profileGifts(String id) =>
      getList('/profiles/$id/gifts', GiftTransaction.fromJson);

  // ──────────────────────────────── Friends ───────────────────────────────
  /// `GET /friends` — the caller's accepted friends with presence.
  Future<Paginated<FriendSummary>> friends({String? cursor, int? limit}) =>
      getPage('/friends', FriendSummary.fromJson, cursor: cursor, limit: limit);

  /// `GET /friends/requests` — the caller's pending friend requests, BOTH
  /// directions (`{ incoming, outgoing }`). Incoming = people who asked you
  /// (accept via [acceptFriendRequest]); outgoing = requests you sent that are
  /// still pending (cancel via [removeFriendship]).
  Future<FriendRequestsResponse> friendRequests({CancelToken? cancelToken}) =>
      getJson('/friends/requests', FriendRequestsResponse.fromJson,
          cancelToken: cancelToken);

  /// `POST /friends/request` — send a friend request.
  Future<Friendship> sendFriendRequest(String recipientId) => sendJson(
        'POST',
        '/friends/request',
        Friendship.fromJson,
        body: {'recipientId': recipientId},
      );

  /// `POST /friends/:id/accept` — accept a pending request.
  Future<Friendship> acceptFriendRequest(String friendshipId) =>
      sendJson('POST', '/friends/$friendshipId/accept', Friendship.fromJson);

  /// `DELETE /friends/:id` — remove a friendship / decline a request.
  Future<void> removeFriendship(String friendshipId) =>
      sendVoid('DELETE', '/friends/$friendshipId');

  // ───────────────────────────────── Chat ─────────────────────────────────
  /// `GET /conversations` — the caller's conversations (recent first).
  Future<Paginated<Conversation>> conversations({String? cursor, int? limit}) =>
      getPage('/conversations', Conversation.fromJson, cursor: cursor, limit: limit);

  /// `GET /conversations/:id/messages` — messages, newest first.
  Future<Paginated<Message>> messages(
    String conversationId, {
    String? cursor,
    int? limit,
  }) =>
      getPage(
        '/conversations/$conversationId/messages',
        Message.fromJson,
        cursor: cursor,
        limit: limit,
      );

  /// `POST /messages` — send a DM (creates the conversation if needed).
  Future<Message> sendMessage(SendMessageDto dto) =>
      sendJson('POST', '/messages', Message.fromJson, body: dto.toJson());

  // ──────────────────────────────── Economy ───────────────────────────────
  /// `GET /wallet` — the caller's coin balance.
  Future<Wallet> wallet() => getJson('/wallet', Wallet.fromJson);

  /// `GET /wallet/transactions` — paginated coin ledger.
  Future<Paginated<CoinTransaction>> transactions({String? cursor, int? limit}) =>
      getPage('/wallet/transactions', CoinTransaction.fromJson,
          cursor: cursor, limit: limit);

  /// `GET /coin-packages` — purchasable coin bundles.
  Future<List<CoinPackage>> coinPackages() =>
      getList('/coin-packages', CoinPackage.fromJson);

  /// `GET /gifts` — the gift catalog.
  Future<List<Gift>> gifts() => getList('/gifts', Gift.fromJson);

  /// `POST /gifts/send` — send a gift.
  Future<GiftTransaction> sendGift(SendGiftDto dto) =>
      sendJson('POST', '/gifts/send', GiftTransaction.fromJson, body: dto.toJson());

  /// `GET /top` — the current Top feed placements.
  Future<List<TopPlacement>> topFeed() => getList('/top', TopPlacement.fromJson);

  /// `POST /top/purchase` — buy a Top placement.
  Future<TopPlacement> purchaseTop(TopPurchaseDto dto) =>
      sendJson('POST', '/top/purchase', TopPlacement.fromJson, body: dto.toJson());

  /// `GET /premium/plans` — subscription tiers.
  Future<List<PremiumPlan>> premiumPlans() =>
      getList('/premium/plans', PremiumPlan.fromJson);

  /// `POST /premium/subscribe` — start/confirm a subscription to [planCode].
  Future<Subscription> subscribe(String planCode) => sendJson(
        'POST',
        '/premium/subscribe',
        Subscription.fromJson,
        body: {'plan': planCode},
      );

  /// `POST /premium/cancel` — cancel at period end.
  Future<Subscription> cancelSubscription() =>
      sendJson('POST', '/premium/cancel', Subscription.fromJson);

  // ──────────────────────────────── Payments ──────────────────────────────
  /// `POST /payments/coins/checkout` — get CloudPayments widget params for a
  /// coin package (opened in a WebView fallback on mobile).
  Future<CheckoutWidgetParams> coinsCheckout(String packageCode) => sendJson(
        'POST',
        '/payments/coins/checkout',
        CheckoutWidgetParams.fromJson,
        body: {'packageCode': packageCode},
      );

  // ─────────────────────────────── Settings ───────────────────────────────
  /// `GET /settings` — the caller's settings document.
  Future<Settings> settings() => getJson('/settings', Settings.fromJson);

  /// `PATCH /settings` — partial settings update.
  Future<Settings> updateSettings(UpdateSettingsDto dto) =>
      sendJson('PATCH', '/settings', Settings.fromJson, body: dto.toJson());

  // ────────────────────────────── Moderation ──────────────────────────────
  /// `POST /reports` — report a user.
  Future<void> report(CreateReportDto dto) =>
      sendVoid('POST', '/reports', body: dto.toJson());

  /// `POST /blocks` — block a user.
  Future<void> block(String blockedUserId) =>
      sendVoid('POST', '/blocks', body: {'blockedUserId': blockedUserId});

  /// `DELETE /blocks/:blockedUserId` — unblock a user.
  Future<void> unblock(String blockedUserId) =>
      sendVoid('DELETE', '/blocks/$blockedUserId');

  /// `GET /blocks` — the caller's blocked users.
  Future<List<Block>> blocks() => getList('/blocks', Block.fromJson);

  // ──────────────────────── Presence / WebRTC (TURN) ──────────────────────
  /// `GET /presence/:id` — a user's current online status.
  Future<PresencePayload> presence(String userId) =>
      getJson('/presence/$userId', PresencePayload.fromJson);

  /// `GET /turn/credentials` — ephemeral ICE servers (STUN/TURN) for WebRTC.
  /// Returns the raw map (`{ iceServers: [...], ttlExpiresAt }`) for the
  /// roulette feature to feed into RTCPeerConnection.
  Future<Map<String, dynamic>> turnCredentials() =>
      getJson('/turn/credentials', (json) => json);

  // ───────────────────────────────── Users ────────────────────────────────
  /// `DELETE /users/me` — irreversible account deletion + erasure.
  Future<void> deleteAccount() => sendVoid('DELETE', '/users/me');

  // ───────────────────────────── Notifications ────────────────────────────
  /// `GET /notifications` — the caller's stored notifications, newest first.
  /// `unreadOnly` restricts to unseen items (`listNotificationsQuerySchema`).
  Future<Paginated<NotificationItem>> notifications({
    String? cursor,
    int? limit,
    bool? unreadOnly,
  }) =>
      getPage(
        '/notifications',
        NotificationItem.fromJson,
        cursor: cursor,
        limit: limit,
        extraQuery: {if (unreadOnly == true) 'unreadOnly': true},
      );

  /// `GET /notifications/unread-count` — `{ count }` for the header badge.
  Future<UnreadCount> notificationsUnreadCount() =>
      getJson('/notifications/unread-count', UnreadCount.fromJson);

  /// `POST /notifications/:id/read` — mark a single notification as read.
  Future<void> markNotificationRead(String id) =>
      sendVoid('POST', '/notifications/$id/read');

  /// `POST /notifications/read-all` — mark every notification as read.
  Future<void> markAllNotificationsRead() =>
      sendVoid('POST', '/notifications/read-all');

  /// `POST /notifications/push/device-token` — register an FCM/APNs token for
  /// the calling device (`devicePushTokenSchema`).
  Future<void> registerPushDeviceToken(DevicePushTokenDto dto) =>
      sendVoid('POST', '/notifications/push/device-token', body: dto.toJson());

  /// `DELETE /notifications/push/device-token` — unregister this device's token
  /// (best-effort; e.g. on logout). Sends the token in the body.
  Future<void> unregisterPushDeviceToken(String token) =>
      sendVoid('DELETE', '/notifications/push/device-token',
          body: {'token': token});

  // ───────────────────────────── Leaderboard ──────────────────────────────
  /// `GET /leaderboard` — a ranking by [metric] (`gifts | coins | top`),
  /// capped at [limit] entries (`leaderboardQuerySchema`).
  Future<LeaderboardResponse> leaderboard({
    LeaderboardMetric metric = LeaderboardMetric.gifts,
    int? limit,
    CancelToken? cancelToken,
  }) =>
      getJson(
        '/leaderboard',
        LeaderboardResponse.fromJson,
        query: {
          'metric': metric.wire,
          'limit': ?limit,
        },
        cancelToken: cancelToken,
      );
}
