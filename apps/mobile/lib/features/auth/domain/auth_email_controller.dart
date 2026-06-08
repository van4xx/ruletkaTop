import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api.dart';
import '../../../core/di/di.dart';
import '../../../core/models/models.dart';

/// One-shot async phase for the email-link auth actions (forgot/reset/verify).
enum AuthEmailPhase { idle, busy, success, error }

/// Immutable state for a single email-link auth action.
@immutable
class AuthEmailState {
  const AuthEmailState({this.phase = AuthEmailPhase.idle, this.error});

  final AuthEmailPhase phase;

  /// Human-readable error (Russian-first) from the last failed action.
  final String? error;

  bool get isBusy => phase == AuthEmailPhase.busy;
  bool get isSuccess => phase == AuthEmailPhase.success;
  bool get isError => phase == AuthEmailPhase.error;

  AuthEmailState copyWith({AuthEmailPhase? phase, String? error}) =>
      AuthEmailState(phase: phase ?? this.phase, error: error);
}

/// Drives the password-reset REQUEST flow (`POST /auth/request-password-reset`).
///
/// ANTI-ENUMERATION: the API 204s regardless of whether the email is
/// registered, so this controller ALWAYS resolves to [AuthEmailPhase.success]
/// (even on a transport error we keep the neutral "if that email exists…"
/// confirmation, never revealing the outcome). It only surfaces an [error] for
/// hard input problems the caller should retry (it currently never does — the
/// screen shows the neutral confirmation either way).
class ForgotPasswordController extends Notifier<AuthEmailState> {
  @override
  AuthEmailState build() => const AuthEmailState();

  ApiClient get _api => ref.read(apiClientProvider);

  /// Request a reset email for [email]. Always settles to success.
  Future<void> request(String email) async {
    if (state.isBusy) return;
    state = const AuthEmailState(phase: AuthEmailPhase.busy);
    try {
      await _api.requestPasswordReset(
        RequestPasswordResetDto(email: email.trim()),
      );
    } catch (_) {
      // Swallow — never reveal whether the address exists (mirrors the web).
    }
    state = const AuthEmailState(phase: AuthEmailPhase.success);
  }

  void reset() => state = const AuthEmailState();
}

final forgotPasswordControllerProvider =
    NotifierProvider.autoDispose<ForgotPasswordController, AuthEmailState>(
  ForgotPasswordController.new,
);

/// Drives the password-RESET completion (`POST /auth/reset-password`) using the
/// single-use token from the emailed link. On success the server revokes all
/// sessions, so the screen routes the user back to login to re-authenticate.
class ResetPasswordController extends Notifier<AuthEmailState> {
  @override
  AuthEmailState build() => const AuthEmailState();

  ApiClient get _api => ref.read(apiClientProvider);

  /// Submit a new [password] with the reset [token]. Returns `true` on success.
  Future<bool> submit({required String token, required String password}) async {
    if (state.isBusy) return false;
    state = const AuthEmailState(phase: AuthEmailPhase.busy);
    try {
      await _api.resetPassword(ResetPasswordDto(token: token, password: password));
      state = const AuthEmailState(phase: AuthEmailPhase.success);
      return true;
    } on ApiException catch (e) {
      state = AuthEmailState(phase: AuthEmailPhase.error, error: e.message);
      return false;
    } catch (_) {
      state = const AuthEmailState(
        phase: AuthEmailPhase.error,
        error: 'Не удалось сменить пароль. Попробуйте ещё раз.',
      );
      return false;
    }
  }
}

final resetPasswordControllerProvider =
    NotifierProvider.autoDispose<ResetPasswordController, AuthEmailState>(
  ResetPasswordController.new,
);

/// Drives email-VERIFICATION from the emailed token (`POST /auth/verify-email`)
/// and re-sending the verification email (`POST /auth/resend-verification`).
class VerifyEmailController extends Notifier<AuthEmailState> {
  @override
  AuthEmailState build() => const AuthEmailState();

  ApiClient get _api => ref.read(apiClientProvider);

  /// Confirm an email with [token]. Returns `true` on success.
  Future<bool> verify(String token) async {
    if (state.isBusy) return false;
    state = const AuthEmailState(phase: AuthEmailPhase.busy);
    try {
      await _api.verifyEmail(VerifyEmailDto(token: token));
      state = const AuthEmailState(phase: AuthEmailPhase.success);
      // The session's emailVerified just flipped — refresh the cached user so a
      // mounted "verify your email" banner disappears.
      await ref.read(authControllerProvider.notifier).refreshUser();
      return true;
    } on ApiException catch (e) {
      state = AuthEmailState(phase: AuthEmailPhase.error, error: e.message);
      return false;
    } catch (_) {
      state = const AuthEmailState(
        phase: AuthEmailPhase.error,
        error: 'Ссылка недействительна или устарела.',
      );
      return false;
    }
  }

  /// Re-send the verification email to the signed-in user. Returns an error
  /// message on failure, or `null` on success.
  Future<String?> resend() async {
    try {
      await _api.resendVerification();
      return null;
    } on ApiException catch (e) {
      return e.message;
    } catch (_) {
      return 'Не удалось отправить письмо. Попробуйте позже.';
    }
  }
}

final verifyEmailControllerProvider =
    NotifierProvider.autoDispose<VerifyEmailController, AuthEmailState>(
  VerifyEmailController.new,
);
