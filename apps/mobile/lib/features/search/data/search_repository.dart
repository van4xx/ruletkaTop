import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api.dart';
import '../../../core/di/di.dart';
import '../../../core/models/models.dart';

/// Thin repository over the people-discovery endpoint (`GET /profiles/search`,
/// declared on [ApiEndpoints]). Keeps the search controller off the raw
/// [ApiClient] and gives one place to evolve transforms/caching.
///
/// The endpoint is nickname-prefix search with optional `gender` / `country`
/// facets, returning a cursor-paginated [Paginated] page of [PublicProfile]s.
class SearchRepository {
  SearchRepository(this._api);

  final ApiClient _api;

  /// `GET /profiles/search` — one page of matching public profiles. A
  /// [cancelToken] lets the controller abort an in-flight request when the
  /// query changes (debounce/typing).
  Future<Paginated<PublicProfile>> search({
    String? q,
    Gender? gender,
    String? country,
    String? cursor,
    int? limit,
    CancelToken? cancelToken,
  }) =>
      _api.searchProfiles(
        q: q,
        gender: gender,
        country: country,
        cursor: cursor,
        limit: limit,
        cancelToken: cancelToken,
      );
}

/// The search repository, built on the shared [apiClientProvider].
final searchRepositoryProvider = Provider<SearchRepository>((ref) {
  return SearchRepository(ref.watch(apiClientProvider));
});
