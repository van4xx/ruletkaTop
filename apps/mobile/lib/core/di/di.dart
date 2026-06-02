/// Barrel for dependency injection + auth state.
///
/// `import 'package:ruletka/core/di/di.dart';` gives you every provider
/// ([apiClientProvider], [socketServiceProvider], [tokenStoreProvider],
/// [authControllerProvider]/[authStateProvider], [currentUserProvider],
/// [currentUserIdProvider]) plus [AuthController]/[AuthState]/[AuthStatus].
library;

export 'auth_controller.dart';
export 'providers.dart';
