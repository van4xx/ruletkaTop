// Smoke test: the app boots into the splash, then resolves to the login shell
// (no persisted session) without throwing.
//
// Notes:
//  * `flutter_secure_storage` has no platform implementation under the test
//    binding, so we stub its MethodChannel to return null (no refresh token).
//  * We avoid `pumpAndSettle` because the splash + login both run indefinite
//    animations (progress spinner, shimmer); instead we pump fixed frames.

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ruletka/features/auth/presentation/login_screen.dart';
import 'package:ruletka/main.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    // Stub secure storage: every read returns null → no persisted session.
    const channel = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'read' || call.method == 'readAll') return null;
      return null;
    });
  });

  testWidgets('boots and settles on the login shell', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: RuletkaApp()));

    // Drive the post-frame bootstrap + redirect with fixed pumps (the splash
    // and login screens animate forever, so pumpAndSettle would time out).
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 120));
    }

    expect(find.byType(LoginScreen), findsOneWidget);
    expect(find.text('Войти'), findsOneWidget);
  });
}
