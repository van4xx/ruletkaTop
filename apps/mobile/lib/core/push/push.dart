/// Barrel for push notifications.
///
/// `import 'package:ruletka/core/push/push.dart';` gives you the [PushService]
/// abstraction + keyless [NoopPushService], the FCM-backed [FirebasePushService]
/// (+ its top-level [firebaseMessagingBackgroundHandler]), the [PushController]
/// and [pushServiceProvider]/[pushControllerProvider].
library;

export 'firebase_push_service.dart';
export 'push_providers.dart';
export 'push_service.dart';
