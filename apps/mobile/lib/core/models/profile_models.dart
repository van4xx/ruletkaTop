/// Mirrors `packages/shared-types/src/profile.ts`.
library;

import 'enums.dart';

/// `publicProfileSchema` — the public view of any user.
class PublicProfile {
  const PublicProfile({
    required this.id,
    required this.nickname,
    required this.avatarUrl,
    required this.status,
    required this.gender,
    required this.age,
    required this.country,
    required this.languages,
    this.interests = const [],
    required this.badges,
    required this.isPremium,
    required this.profileViews,
    required this.createdAt,
  });

  final String id;
  final String nickname;
  final String? avatarUrl;
  final String? status;
  final Gender gender;
  final int age;
  final String country;
  final List<Locale> languages;

  /// Free-form interest tags (curated keys like `music`, or custom strings).
  /// Used to prioritise — and optionally gate — matchmaking. Pre-interests
  /// profiles omit the field, so it defaults to an empty list.
  final List<String> interests;
  final List<Badge> badges;
  final bool isPremium;
  final int profileViews;
  final DateTime createdAt;

  factory PublicProfile.fromJson(Map<String, dynamic> json) => PublicProfile(
        id: json['id'] as String,
        nickname: json['nickname'] as String? ?? '',
        avatarUrl: json['avatarUrl'] as String?,
        status: json['status'] as String?,
        gender: Gender.fromWire(json['gender'] as String?),
        age: (json['age'] as num?)?.toInt() ?? 18,
        country: json['country'] as String? ?? 'RU',
        languages: ((json['languages'] as List?) ?? const [])
            .map((e) => Locale.fromWire(e as String?))
            .toList(growable: false),
        interests: ((json['interests'] as List?) ?? const [])
            .map((e) => e as String)
            .toList(growable: false),
        badges: Badge.listFromWire(json['badges']),
        isPremium: json['isPremium'] as bool? ?? false,
        profileViews: (json['profileViews'] as num?)?.toInt() ?? 0,
        createdAt:
            DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.fromMillisecondsSinceEpoch(0),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'nickname': nickname,
        'avatarUrl': avatarUrl,
        'status': status,
        'gender': gender.wire,
        'age': age,
        'country': country,
        'languages': languages.map((e) => e.wire).toList(),
        'interests': interests,
        'badges': badges.map((e) => e.wire).toList(),
        'isPremium': isPremium,
        'profileViews': profileViews,
        'createdAt': createdAt.toIso8601String(),
      };
}

/// `updateProfileSchema` — all fields optional (PATCH /profiles/me).
class UpdateProfileDto {
  const UpdateProfileDto({
    this.nickname,
    this.status,
    this.avatarUrl,
    this.gender,
    this.birthDate,
    this.country,
    this.languages,
    this.interests,
  });

  final String? nickname;
  final String? status;
  final String? avatarUrl;
  final Gender? gender;
  final String? birthDate;
  final String? country;
  final List<Locale>? languages;

  /// Up to 10 interest tags (each ≤24 chars). `null` leaves them untouched on a
  /// PATCH; an empty list explicitly clears them.
  final List<String>? interests;

  Map<String, dynamic> toJson() => {
        if (nickname != null) 'nickname': nickname,
        if (status != null) 'status': status,
        if (avatarUrl != null) 'avatarUrl': avatarUrl,
        if (gender != null) 'gender': gender!.wire,
        if (birthDate != null) 'birthDate': birthDate,
        if (country != null) 'country': country,
        if (languages != null) 'languages': languages!.map((e) => e.wire).toList(),
        if (interests != null) 'interests': interests,
      };
}
