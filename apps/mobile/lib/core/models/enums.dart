/// Dart mirror of every string-enum in `@ruletka/shared-types`.
///
/// Each enum exposes:
///  * a stable [wire] value (the exact string the API sends/expects);
///  * `fromWire` (tolerant: unknown values fall back to a safe default rather
///    than throwing, so a server adding a variant never crashes the client).
///
/// Keep these in lock-step with `packages/shared-types/src/common.ts` (+ the
/// per-domain files). They are the single source of truth for serialization.
library;

/// `genderSchema` — `'male' | 'female' | 'other'`.
enum Gender {
  male('male'),
  female('female'),
  other('other');

  const Gender(this.wire);
  final String wire;

  static Gender fromWire(String? value) =>
      Gender.values.firstWhere((e) => e.wire == value, orElse: () => Gender.other);
}

/// `genderPreferenceSchema` — matchmaking filter — `'any' | 'male' | 'female'`.
enum GenderPreference {
  any('any'),
  male('male'),
  female('female');

  const GenderPreference(this.wire);
  final String wire;

  static GenderPreference fromWire(String? value) => GenderPreference.values
      .firstWhere((e) => e.wire == value, orElse: () => GenderPreference.any);
}

/// `matchTypeSchema` — `'video' | 'voice'`.
enum MatchType {
  video('video'),
  voice('voice');

  const MatchType(this.wire);
  final String wire;

  static MatchType fromWire(String? value) =>
      MatchType.values.firstWhere((e) => e.wire == value, orElse: () => MatchType.video);
}

/// `localeSchema` — `'ru' | 'en'`.
enum Locale {
  ru('ru'),
  en('en');

  const Locale(this.wire);
  final String wire;

  static Locale fromWire(String? value) =>
      Locale.values.firstWhere((e) => e.wire == value, orElse: () => Locale.ru);
}

/// `themeSchema` — `'light' | 'dark' | 'system'`.
enum AppThemeMode {
  light('light'),
  dark('dark'),
  system('system');

  const AppThemeMode(this.wire);
  final String wire;

  static AppThemeMode fromWire(String? value) => AppThemeMode.values
      .firstWhere((e) => e.wire == value, orElse: () => AppThemeMode.system);
}

/// `roleSchema` — `'user' | 'moderator' | 'admin'`.
enum Role {
  user('user'),
  moderator('moderator'),
  admin('admin');

  const Role(this.wire);
  final String wire;

  static Role fromWire(String? value) =>
      Role.values.firstWhere((e) => e.wire == value, orElse: () => Role.user);

  bool get isStaff => this == Role.moderator || this == Role.admin;
}

/// `badgeSchema` — `'premium' | 'verified' | 'top' | 'staff'`.
enum Badge {
  premium('premium'),
  verified('verified'),
  top('top'),
  staff('staff');

  const Badge(this.wire);
  final String wire;

  static Badge? fromWire(String? value) {
    for (final e in Badge.values) {
      if (e.wire == value) return e;
    }
    return null;
  }

  static List<Badge> listFromWire(dynamic value) {
    if (value is! List) return const [];
    return value
        .map((e) => Badge.fromWire(e as String?))
        .whereType<Badge>()
        .toList(growable: false);
  }
}

/// `raritySchema` — `'common' | 'rare' | 'epic' | 'legendary'`.
enum Rarity {
  common('common'),
  rare('rare'),
  epic('epic'),
  legendary('legendary');

  const Rarity(this.wire);
  final String wire;

  static Rarity fromWire(String? value) =>
      Rarity.values.firstWhere((e) => e.wire == value, orElse: () => Rarity.common);
}

/// `onlineStatusSchema` — `'online' | 'offline' | 'in_call' | 'away'`.
enum OnlineStatus {
  online('online'),
  offline('offline'),
  inCall('in_call'),
  away('away');

  const OnlineStatus(this.wire);
  final String wire;

  static OnlineStatus fromWire(String? value) => OnlineStatus.values
      .firstWhere((e) => e.wire == value, orElse: () => OnlineStatus.offline);
}

/// `friendshipStatusSchema` — `'pending' | 'accepted' | 'blocked'`.
enum FriendshipStatus {
  pending('pending'),
  accepted('accepted'),
  blocked('blocked');

  const FriendshipStatus(this.wire);
  final String wire;

  static FriendshipStatus fromWire(String? value) => FriendshipStatus.values
      .firstWhere((e) => e.wire == value, orElse: () => FriendshipStatus.pending);
}

/// `messageTypeSchema` — `'text' | 'image' | 'gift'`.
enum MessageType {
  text('text'),
  image('image'),
  gift('gift');

  const MessageType(this.wire);
  final String wire;

  static MessageType fromWire(String? value) =>
      MessageType.values.firstWhere((e) => e.wire == value, orElse: () => MessageType.text);
}

/// `coinTxTypeSchema` — `'purchase' | 'gift_out' | 'gift_in' | 'top' | 'bonus' | 'refund'`.
enum CoinTxType {
  purchase('purchase'),
  giftOut('gift_out'),
  giftIn('gift_in'),
  top('top'),
  bonus('bonus'),
  refund('refund');

  const CoinTxType(this.wire);
  final String wire;

  static CoinTxType fromWire(String? value) =>
      CoinTxType.values.firstWhere((e) => e.wire == value, orElse: () => CoinTxType.bonus);
}

/// `topLaneSchema` — `'left' | 'right'`.
enum TopLane {
  left('left'),
  right('right');

  const TopLane(this.wire);
  final String wire;

  static TopLane fromWire(String? value) =>
      TopLane.values.firstWhere((e) => e.wire == value, orElse: () => TopLane.left);
}

/// `subscriptionStatusSchema` — `'active' | 'canceled' | 'past_due' | 'none'`.
enum SubscriptionStatus {
  active('active'),
  canceled('canceled'),
  pastDue('past_due'),
  none('none');

  const SubscriptionStatus(this.wire);
  final String wire;

  static SubscriptionStatus fromWire(String? value) => SubscriptionStatus.values
      .firstWhere((e) => e.wire == value, orElse: () => SubscriptionStatus.none);
}

/// `reportReasonSchema` — nudity/harassment/minor/violence/spam/scam/other.
enum ReportReason {
  nudity('nudity'),
  harassment('harassment'),
  minor('minor'),
  violence('violence'),
  spam('spam'),
  scam('scam'),
  other('other');

  const ReportReason(this.wire);
  final String wire;

  static ReportReason fromWire(String? value) =>
      ReportReason.values.firstWhere((e) => e.wire == value, orElse: () => ReportReason.other);
}

/// `giftContextSchema` — where a gift is sent from — `'call' | 'chat' | 'profile'`.
enum GiftContext {
  call('call'),
  chat('chat'),
  profile('profile');

  const GiftContext(this.wire);
  final String wire;

  static GiftContext fromWire(String? value) =>
      GiftContext.values.firstWhere((e) => e.wire == value, orElse: () => GiftContext.profile);
}

/// `matchEndReasonSchema` — `'next' | 'stop' | 'disconnect' | 'timeout' | 'reported'`.
enum MatchEndReason {
  next('next'),
  stop('stop'),
  disconnect('disconnect'),
  timeout('timeout'),
  reported('reported');

  const MatchEndReason(this.wire);
  final String wire;

  static MatchEndReason fromWire(String? value) =>
      MatchEndReason.values.firstWhere((e) => e.wire == value, orElse: () => MatchEndReason.stop);
}

/// `visibilitySchema` (settings) — `'everyone' | 'friends' | 'nobody'`.
enum Visibility {
  everyone('everyone'),
  friends('friends'),
  nobody('nobody');

  const Visibility(this.wire);
  final String wire;

  static Visibility fromWire(String? value) =>
      Visibility.values.firstWhere((e) => e.wire == value, orElse: () => Visibility.everyone);
}

/// `appNotificationSchema.kind` — `friend_request | message | gift | call | system`.
enum NotificationKind {
  friendRequest('friend_request'),
  message('message'),
  gift('gift'),
  call('call'),
  system('system');

  const NotificationKind(this.wire);
  final String wire;

  static NotificationKind fromWire(String? value) => NotificationKind.values
      .firstWhere((e) => e.wire == value, orElse: () => NotificationKind.system);
}

/// `moderationLabelSchema` — the AI-screening category space —
/// `nudity | sexual | violence | minor | safe | other`.
enum ModerationLabel {
  nudity('nudity'),
  sexual('sexual'),
  violence('violence'),
  minor('minor'),
  safe('safe'),
  other('other');

  const ModerationLabel(this.wire);
  final String wire;

  static ModerationLabel fromWire(String? value) => ModerationLabel.values
      .firstWhere((e) => e.wire == value, orElse: () => ModerationLabel.other);
}

/// `moderationActionSchema` — escalating enforcement applied to an offender —
/// `none | blur | warn | kick | ban`.
enum ModerationAction {
  none('none'),
  blur('blur'),
  warn('warn'),
  kick('kick'),
  ban('ban');

  const ModerationAction(this.wire);
  final String wire;

  static ModerationAction fromWire(String? value) => ModerationAction.values
      .firstWhere((e) => e.wire == value, orElse: () => ModerationAction.none);
}

/// `wsErrorPayloadSchema.code` — realtime rejection reason.
enum WsErrorCode {
  rateLimited('rate_limited'),
  tooManyConnections('too_many_connections'),
  forbidden('forbidden'),
  banned('banned'),
  unauthorized('unauthorized');

  const WsErrorCode(this.wire);
  final String wire;

  static WsErrorCode fromWire(String? value) =>
      WsErrorCode.values.firstWhere((e) => e.wire == value, orElse: () => WsErrorCode.forbidden);
}
