import 'package:flutter/foundation.dart';

import '../../../core/api/api.dart';
import 'webrtc_service.dart';

/// Fetches ephemeral ICE servers for WebRTC from `GET /turn/credentials`.
///
/// The endpoint returns `{ iceServers: [...], ttlExpiresAt }`. We map the
/// `iceServers` into [IceServerConfig]s; on any failure we fall back to public
/// STUN ([kFallbackIceServers]) so a same-network call can still connect in
/// local dev (mirrors the web `ensureIceServers`).
class TurnRepository {
  TurnRepository(this._api);

  final ApiClient _api;

  Future<List<IceServerConfig>> fetchIceServers() async {
    try {
      final json = await _api.turnCredentials();
      final raw = json['iceServers'];
      if (raw is List && raw.isNotEmpty) {
        final servers = raw
            .whereType<Map>()
            .map((e) => IceServerConfig.fromJson(Map<String, dynamic>.from(e)))
            .toList(growable: false);
        if (servers.isNotEmpty) return servers;
      }
    } catch (e) {
      if (kDebugMode) debugPrint('[turn] credentials fetch failed, using STUN fallback: $e');
    }
    return kFallbackIceServers;
  }
}
