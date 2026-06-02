import 'package:flutter/material.dart';

import '../theme/theme.dart';

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
            Container(
              width: 88,
              height: 88,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: LinearGradient(colors: colors.brandGradient),
                boxShadow: AppShadows.glow(colors.neonViolet, strength: 0.8),
              ),
              child: const Icon(Icons.bolt_rounded, size: 46, color: Colors.white),
            ),
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
