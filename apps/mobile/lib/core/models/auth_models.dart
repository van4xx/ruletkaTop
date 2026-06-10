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
    this.emailVerified,
  });

  final String id;
  final String email;
  final Role role;
  final String nickname;
  final bool isPremium;

  /// Whether the account's email is confirmed. Optional/additive in the
  /// contract — `null` for older API responses that predate the field (the UI
  /// then simply hides the "verify your email" affordance).
  final bool? emailVerified;

  factory AuthUser.fromJson(Map<String, dynamic> json) => AuthUser(
        id: json['id'] as String,
        email: json['email'] as String? ?? '',
        role: Role.fromWire(json['role'] as String?),
        nickname: json['nickname'] as String? ?? '',
        isPremium: json['isPremium'] as bool? ?? false,
        emailVerified: json['emailVerified'] as bool?,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'email': email,
        'role': role.wire,
        'nickname': nickname,
        'isPremium': isPremium,
        if (emailVerified != null) 'emailVerified': emailVerified,
      };

  AuthUser copyWith({
    String? nickname,
    bool? isPremium,
    Role? role,
    bool? emailVerified,
  }) =>
      AuthUser(
        id: id,
        email: email,
        role: role ?? this.role,
        nickname: nickname ?? this.nickname,
        isPremium: isPremium ?? this.isPremium,
        emailVerified: emailVerified ?? this.emailVerified,
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
    this.acceptedAdult = true,
  });

  final String email;
  final String password;
  final String nickname;
  final Gender gender;
  final String birthDate;
  final String country;
  final Locale? locale;
  final bool acceptedTerms;
  // AGE-GATE LEVEL 1: explicit 18+ self-attestation. The API requires this to
  // be `true` (audited as `user.consent.adult` server-side), as a SEPARATE
  // consent record from `acceptedTerms` — even if the self-attested birthDate
  // already passes the 18+ check. The register screen toggles it via its own
  // checkbox; the controller sends it on the wire.
  final bool acceptedAdult;

  Map<String, dynamic> toJson() => {
        'email': email,
        'password': password,
        'nickname': nickname,
        'gender': gender.wire,
        'birthDate': birthDate,
        'country': country,
        if (locale != null) 'locale': locale!.wire,
        'acceptedTerms': acceptedTerms,
        'acceptedAdult': acceptedAdult,
      };
}

/// `loginSchema` request body.
class LoginDto {
  const LoginDto({required this.email, required this.password});

  final String email;
  final String password;

  Map<String, dynamic> toJson() => {'email': email, 'password': password};
}

// ── Email verification + password reset (token-based, emailed link) ──

/// `requestPasswordResetSchema` — `{ email }`. The API always 204s (never
/// reveals whether the email is registered).
class RequestPasswordResetDto {
  const RequestPasswordResetDto({required this.email});

  final String email;

  Map<String, dynamic> toJson() => {'email': email};
}

/// `resetPasswordSchema` — `{ token, password }`. The single-use token comes
/// from the emailed link; setting the password revokes all sessions.
class ResetPasswordDto {
  const ResetPasswordDto({required this.token, required this.password});

  final String token;
  final String password;

  Map<String, dynamic> toJson() => {'token': token, 'password': password};
}

/// `verifyEmailSchema` — `{ token }` from the emailed verification link.
class VerifyEmailDto {
  const VerifyEmailDto({required this.token});

  final String token;

  Map<String, dynamic> toJson() => {'token': token};
}

/// `changePasswordSchema` — change the password of an ALREADY-authenticated
/// account (the user knows their current password). Distinct from the
/// emailed-token reset flow. The server verifies `currentPassword` and revokes
/// all sessions on success.
class ChangePasswordDto {
  const ChangePasswordDto({
    required this.currentPassword,
    required this.newPassword,
  });

  final String currentPassword;
  final String newPassword;

  Map<String, dynamic> toJson() => {
        'currentPassword': currentPassword,
        'newPassword': newPassword,
      };
}

// ── Active sessions / device management ──

/// `authSessionSchema` — one ACTIVE login (refresh-token rotation family) as
/// surfaced for review/revocation by `GET /auth/sessions`. The raw refresh
/// token is never exposed: [id] is the family identifier (stable across
/// rotations), so revoking by it kills that whole device/login. [current] flags
/// the session the requesting device is using right now.
class AuthSession {
  const AuthSession({
    required this.id,
    required this.ip,
    required this.userAgent,
    required this.device,
    required this.createdAt,
    required this.lastActiveAt,
    required this.current,
  });

  final String id;
  final String? ip;
  final String? userAgent;

  /// Optional parsed device label (reserved; null until UA parsing lands).
  final String? device;
  final DateTime? createdAt;
  final DateTime? lastActiveAt;

  /// True for the session the requesting device is currently using.
  final bool current;

  factory AuthSession.fromJson(Map<String, dynamic> json) => AuthSession(
        id: json['id'] as String? ?? '',
        ip: json['ip'] as String?,
        userAgent: json['userAgent'] as String?,
        device: json['device'] as String?,
        createdAt: DateTime.tryParse(json['createdAt'] as String? ?? ''),
        lastActiveAt: DateTime.tryParse(json['lastActiveAt'] as String? ?? ''),
        current: json['current'] as bool? ?? false,
      );
}
