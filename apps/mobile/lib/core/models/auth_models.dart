/// Mirrors `packages/shared-types/src/auth.ts`.
library;

import 'enums.dart';

/// `authTokensSchema` — `{ accessToken, refreshToken }`.
class AuthTokens {
  const AuthTokens({required this.accessToken, required this.refreshToken});

  final String accessToken;
  final String refreshToken;

  factory AuthTokens.fromJson(Map<String, dynamic> json) => AuthTokens(
        accessToken: json['accessToken'] as String? ?? '',
        refreshToken: json['refreshToken'] as String? ?? '',
      );

  Map<String, dynamic> toJson() => {
        'accessToken': accessToken,
        'refreshToken': refreshToken,
      };
}

/// `authUserSchema` — the minimal account identity returned by auth routes.
class AuthUser {
  const AuthUser({
    required this.id,
    required this.email,
    required this.role,
    required this.nickname,
    required this.isPremium,
  });

  final String id;
  final String email;
  final Role role;
  final String nickname;
  final bool isPremium;

  factory AuthUser.fromJson(Map<String, dynamic> json) => AuthUser(
        id: json['id'] as String,
        email: json['email'] as String? ?? '',
        role: Role.fromWire(json['role'] as String?),
        nickname: json['nickname'] as String? ?? '',
        isPremium: json['isPremium'] as bool? ?? false,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'email': email,
        'role': role.wire,
        'nickname': nickname,
        'isPremium': isPremium,
      };

  AuthUser copyWith({String? nickname, bool? isPremium, Role? role}) => AuthUser(
        id: id,
        email: email,
        role: role ?? this.role,
        nickname: nickname ?? this.nickname,
        isPremium: isPremium ?? this.isPremium,
      );
}

/// `authResponseSchema` — `{ user, tokens }`.
class AuthResponse {
  const AuthResponse({required this.user, required this.tokens});

  final AuthUser user;
  final AuthTokens tokens;

  factory AuthResponse.fromJson(Map<String, dynamic> json) => AuthResponse(
        user: AuthUser.fromJson(json['user'] as Map<String, dynamic>),
        tokens: AuthTokens.fromJson(json['tokens'] as Map<String, dynamic>),
      );
}

/// `registerSchema` request body. `birthDate` is `yyyy-mm-dd`.
class RegisterDto {
  const RegisterDto({
    required this.email,
    required this.password,
    required this.nickname,
    required this.gender,
    required this.birthDate,
    required this.country,
    this.locale,
    this.acceptedTerms = true,
  });

  final String email;
  final String password;
  final String nickname;
  final Gender gender;
  final String birthDate;
  final String country;
  final Locale? locale;
  final bool acceptedTerms;

  Map<String, dynamic> toJson() => {
        'email': email,
        'password': password,
        'nickname': nickname,
        'gender': gender.wire,
        'birthDate': birthDate,
        'country': country,
        if (locale != null) 'locale': locale!.wire,
        'acceptedTerms': acceptedTerms,
      };
}

/// `loginSchema` request body.
class LoginDto {
  const LoginDto({required this.email, required this.password});

  final String email;
  final String password;

  Map<String, dynamic> toJson() => {'email': email, 'password': password};
}
