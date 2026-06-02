/// Mirrors `packages/shared-types/src/matchmaking.ts`.
library;

import 'enums.dart';

/// `matchFiltersSchema` — the roulette search filters.
class MatchFilters {
  const MatchFilters({
    this.gender = GenderPreference.any,
    this.ageMin = 18,
    this.ageMax = 120,
    this.countries = const [],
    this.sharedInterestsOnly = false,
  });

  final GenderPreference gender;
  final int ageMin;
  final int ageMax;
  final List<String> countries;

  /// Premium-only: when true, only match peers who share ≥1 interest. When
  /// false (the default), shared interests merely boost match priority. Older
  /// payloads omit the field, so it defaults to false.
  final bool sharedInterestsOnly;

  factory MatchFilters.fromJson(Map<String, dynamic> json) => MatchFilters(
        gender: GenderPreference.fromWire(json['gender'] as String?),
        ageMin: (json['ageMin'] as num?)?.toInt() ?? 18,
        ageMax: (json['ageMax'] as num?)?.toInt() ?? 120,
        countries: ((json['countries'] as List?) ?? const [])
            .map((e) => e as String)
            .toList(growable: false),
        sharedInterestsOnly: json['sharedInterestsOnly'] as bool? ?? false,
      );

  Map<String, dynamic> toJson() => {
        'gender': gender.wire,
        'ageMin': ageMin,
        'ageMax': ageMax,
        'countries': countries,
        'sharedInterestsOnly': sharedInterestsOnly,
      };

  MatchFilters copyWith({
    GenderPreference? gender,
    int? ageMin,
    int? ageMax,
    List<String>? countries,
    bool? sharedInterestsOnly,
  }) =>
      MatchFilters(
        gender: gender ?? this.gender,
        ageMin: ageMin ?? this.ageMin,
        ageMax: ageMax ?? this.ageMax,
        countries: countries ?? this.countries,
        sharedInterestsOnly: sharedInterestsOnly ?? this.sharedInterestsOnly,
      );
}

/// `peerInfoSchema` — the matched peer shown in the call overlay.
class PeerInfo {
  const PeerInfo({
    required this.userId,
    required this.nickname,
    required this.age,
    required this.gender,
    required this.country,
    required this.avatarUrl,
    required this.badges,
    required this.isPremium,
  });

  final String userId;
  final String nickname;
  final int age;
  final Gender gender;
  final String country;
  final String? avatarUrl;
  final List<Badge> badges;
  final bool isPremium;

  factory PeerInfo.fromJson(Map<String, dynamic> json) => PeerInfo(
        userId: json['userId'] as String,
        nickname: json['nickname'] as String? ?? '',
        age: (json['age'] as num?)?.toInt() ?? 18,
        gender: Gender.fromWire(json['gender'] as String?),
        country: json['country'] as String? ?? 'RU',
        avatarUrl: json['avatarUrl'] as String?,
        badges: Badge.listFromWire(json['badges']),
        isPremium: json['isPremium'] as bool? ?? false,
      );
}
