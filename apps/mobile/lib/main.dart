import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import 'core/di/di.dart';
import 'core/push/push.dart';
import 'core/router/router.dart';
import 'core/theme/theme.dart';
import 'core/widgets/intro_preloader.dart';
import 'features/calls/presentation/direct_call_host.dart';
import 'features/roulette/data/nsfw_classifier.dart';

/// App entry point.
///
/// Wraps the app in a [ProviderScope] (Riverpod root) and builds
/// [MaterialApp.router] with the dark-first theme and the guarded
/// [routerProvider]. To minimise time-to-first-frame, NOTHING that isn't needed
/// for the first paint runs before [runApp]:
///   * Firebase + push initialise AFTER the first frame (see [RuletkaApp]); push
///     only starts post-authentication anyway, so the brief no-op window is moot.
///   * The on-device NSFW classifier is NOT pre-probed here — it lazy-loads on
///     the first `/video` session, so the model load never sits on the boot path.
void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // Keep portrait-first; the roulette feature can opt into landscape locally.
  SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // Resolve the Unbounded/Manrope typefaces from the BUNDLED assets (declared in
  // pubspec) rather than fetching .ttf from fonts.gstatic.com at runtime — no
  // fallback-font flash/reflow and no cold-launch network dependency.
  GoogleFonts.config.allowRuntimeFetching = false;

  // Register the on-device NSFW backend WITHOUT a boot-time probe (web parity).
  // This is a cheap synchronous function-pointer swap — no asset I/O happens
  // here. The actual model load is deferred to the first `/video` session's
  // `_ensureInterpreter()` (the single load). [TfliteNsfwClassifier] self-guards:
  // when the operator-provisioned `assets/models/nsfw.tflite` is absent the first
  // classify logs once and every frame short-circuits to `safe`, so screening
  // stays inert and NEVER falsely cuts — exactly the prior boot-probe behaviour,
  // minus the native round-trip on time-to-first-frame.
  setNsfwClassifierFactory(tfliteNsfwClassifierFactory);

  runApp(
    const ProviderScope(
      child: RuletkaApp(),
    ),
  );
}

/// Attempt to bring real FCM push online. Returns the [FirebasePushService] when
/// Firebase initializes, else the keyless [NoopPushService]. Never throws. Runs
/// AFTER the first frame so the native Firebase round-trip is off the boot path.
Future<PushService> _resolvePushService() async {
  try {
    await Firebase.initializeApp();
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
    return FirebasePushService();
  } catch (e) {
    if (kDebugMode) {
      debugPrint('[push] Firebase not configured — push disabled (no-op): $e');
    }
    return const NoopPushService();
  }
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
    // resolves to authenticated/unauthenticated. We ALSO bring push online here
    // — AFTER the first frame — so the native Firebase round-trip never sits on
    // time-to-first-frame. Push only starts post-authentication (well after this
    // resolves), so publishing the service here is always in time.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(_resolvePushService().then(setActivePushService));
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
              // Global incoming/outgoing friend-call surface (the native twin of
              // the web ModalHost call-invite listener). Mounted app-wide so a
              // `call:invite` rings from anywhere; inert when signed out.
              const DirectCallHost(),
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
