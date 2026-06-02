import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api.dart';
import '../../../core/di/di.dart';
import '../../../core/models/models.dart';

/// Loads the caller's blocked users (`GET /blocks`) and unblocks them
/// (`DELETE /blocks/:blockedUserId`, optimistic). Backs the Blocklist section.
///
/// The blocks endpoint returns ids + timestamps only (no profile), so the UI
/// renders a neutral row with a shortened id + the date it was blocked.
class BlocklistController extends AsyncNotifier<List<Block>> {
  ApiClient get _api => ref.read(apiClientProvider);

  @override
  Future<List<Block>> build() => _api.blocks();

  /// Re-fetch the blocklist.
  Future<void> reload() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(() => _api.blocks());
  }

  /// Unblock [blockedUserId]. Removes the row optimistically and restores it on
  /// failure (rethrowing so the caller can show a snackbar).
  Future<void> unblock(String blockedUserId) async {
    final previous = state.value ?? const [];
    state = AsyncValue.data(
      previous.where((b) => b.blockedUserId != blockedUserId).toList(),
    );
    try {
      await _api.unblock(blockedUserId);
    } catch (e) {
      state = AsyncValue.data(previous);
      rethrow;
    }
  }
}

/// The blocklist controller for the settings Blocklist section.
final blocklistControllerProvider =
    AsyncNotifierProvider<BlocklistController, List<Block>>(
        BlocklistController.new);
