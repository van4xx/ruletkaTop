import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/di/di.dart';
import 'core/router/router.dart';
import 'core/theme/theme.dart';

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
  @override
  void initState() {
    super.initState();
    // Restore the session (refresh-token → access-token → /auth/me) after the
    // first frame so providers are ready; the guard shows the splash until it
    // resolves to authenticated/unauthenticated.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(authControllerProvider.notifier).bootstrap();
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
      // Clamp text scaling so the neon display type never breaks layouts.
      builder: (context, child) {
        final media = MediaQuery.of(context);
        final clamped = media.textScaler.clamp(minScaleFactor: 0.9, maxScaleFactor: 1.3);
        return MediaQuery(
          data: media.copyWith(textScaler: clamped),
          child: child ?? const SizedBox.shrink(),
        );
      },
    );
  }
}
