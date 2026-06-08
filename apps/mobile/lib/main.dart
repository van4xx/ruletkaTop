import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/di/di.dart';
import 'core/router/router.dart';
import 'core/theme/theme.dart';
import 'core/widgets/intro_preloader.dart';

/// App entry point.
///
/// Wraps the app in a [ProviderScope] (Riverpod root), restores any persisted
/// session from secure storage BEFORE the first frame's routing decision, then
/// builds [MaterialApp.router] with the dark-first theme and the guarded
/// [routerProvider].
void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // Keep portrait-first; the roulette feature can opt into landscape locally.
  SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  runApp(const ProviderScope(child: RuletkaApp()));
}

/// Root widget. Kicks off the auth bootstrap on first build (idempotent) and
/// renders the routed Material app. While [AuthController.bootstrap] runs, the
/// router holds on the splash (auth status == unknown).
class RuletkaApp extends ConsumerStatefulWidget {
  const RuletkaApp({super.key});

  @override
  ConsumerState<RuletkaApp> createState() => _RuletkaAppState();
}

class _RuletkaAppState extends ConsumerState<RuletkaApp> {
  /// First-launch intro state:
  ///  * null  → undecided (still reading the persisted flag);
  ///  * true  → play the one-time neon intro preloader over the app;
  ///  * false → already seen (or storage failed) — no intro.
  bool? _showIntro;

  @override
  void initState() {
    super.initState();
    // Restore the session (refresh-token → access-token → /auth/me) after the
    // first frame so providers are ready; the guard shows the splash until it
    // resolves to authenticated/unauthenticated.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(authControllerProvider.notifier).bootstrap();
    });
    // Decide whether to play the first-launch intro (persisted once per install).
    hasSeenIntro().then((seen) {
      if (mounted) setState(() => _showIntro = !seen);
    });
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);

    return MaterialApp.router(
      title: 'ruletka.top',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      // Dark is the hero theme.
      themeMode: ThemeMode.dark,
      routerConfig: router,
      // Clamp text scaling so the neon display type never breaks layouts, and
      // overlay the one-time first-launch intro preloader above the routed app.
      builder: (context, child) {
        final media = MediaQuery.of(context);
        final clamped = media.textScaler.clamp(minScaleFactor: 0.9, maxScaleFactor: 1.3);
        return MediaQuery(
          data: media.copyWith(textScaler: clamped),
          child: Stack(
            children: [
              child ?? const SizedBox.shrink(),
              // The intro plays ONCE per install over the void; on finish we
              // drop the overlay to reveal the app beneath.
              if (_showIntro == true)
                Positioned.fill(
                  child: IntroPreloader(
                    onFinished: () {
                      if (mounted) setState(() => _showIntro = false);
                    },
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}
