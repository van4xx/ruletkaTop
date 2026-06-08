import 'package:flutter/material.dart';

import '../theme/theme.dart';
import '../widgets/widgets.dart';

/// Shown while [AuthController.bootstrap] resolves the session on cold start
/// (auth status == unknown). The router redirects away from here as soon as
/// the status becomes authenticated/unauthenticated.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // The neon roulette-orbit brand mark (matches the web logo).
            const BrandLogo(size: 88, glow: true),
            const SizedBox(height: AppSpacing.xl),
            SizedBox(
              width: 26,
              height: 26,
              child: CircularProgressIndicator(strokeWidth: 2.4, color: colors.neonViolet),
            ),
          ],
        ),
      ),
    );
  }
}
