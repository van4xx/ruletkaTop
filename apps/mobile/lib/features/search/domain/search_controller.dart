import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api.dart';
import '../../../core/models/models.dart';
import '../data/search_repository.dart';

/// ─────────────────────────────────────────────────────────────────────────
/// People-discovery state for `/search`.
///
/// [SearchFiltersNotifier] holds the live, user-editable query + facets (the
/// search field and filter chips write to it). [SearchResultsNotifier] watches
/// those filters, debounces them, hits `GET /profiles/search` (cancelling any
/// in-flight request when the inputs change) and accumulates cursor pages.
///
/// The endpoint facets server-side by `gender` + `country`; the `online`
/// toggle is applied client-side over the shared live presence map (visible
/// result ids are subscribed so their status streams in).
/// ─────────────────────────────────────────────────────────────────────────

/// The user-editable search inputs. `q` is a nickname prefix; [gender] and
/// [country] are server facets; [onlineOnly] is a client-side presence filter.
@immutable
class SearchFilters {
  const SearchFilters({
    this.q = '',
    this.gender,
    this.country,
    this.onlineOnly = false,
  });

  /// Nickname-prefix query (trimmed before it hits the wire).
  final String q;

  /// Gender facet (`null` = any).
  final Gender? gender;

  /// ISO-3166 alpha-2 country facet (`null` = any).
  final String? country;

  /// Show only currently-online people (client-side, over live presence).
  final bool onlineOnly;

  bool get hasServerCriteria =>
      q.trim().isNotEmpty || gender != null || (country != null && country!.isNotEmpty);

  bool get hasAnyCriteria => hasServerCriteria || onlineOnly;

  SearchFilters copyWith({
    String? q,
    Object? gender = _unset,
    Object? country = _unset,
    bool? onlineOnly,
  }) =>
      SearchFilters(
        q: q ?? this.q,
        gender: gender == _unset ? this.gender : gender as Gender?,
        country: country == _unset ? this.country : country as String?,
        onlineOnly: onlineOnly ?? this.onlineOnly,
      );

  /// A sentinel distinguishing "leave unchanged" from "set to null" in
  /// [copyWith] for the nullable fields.
  static const Object _unset = Object();

  @override
  bool operator ==(Object other) =>
      other is SearchFilters &&
      other.q == q &&
      other.gender == gender &&
      other.country == country &&
      other.onlineOnly == onlineOnly;

  @override
  int get hashCode => Object.hash(q, gender, country, onlineOnly);
}

/// The live, user-editable filters. Plain [Notifier] so the field/chips can
/// patch individual facets without rebuilding the (heavier) results notifier.
class SearchFiltersNotifier extends Notifier<SearchFilters> {
  @override
  SearchFilters build() => const SearchFilters();

  void setQuery(String value) => state = state.copyWith(q: value);
  void clearQuery() => state = state.copyWith(q: '');
  void setGender(Gender? value) => state = state.copyWith(gender: value);
  void setCountry(String? value) => state = state.copyWith(country: value);
  void toggleOnline() => state = state.copyWith(onlineOnly: !state.onlineOnly);

  /// Reset every facet to its default (the "Сбросить" affordance).
  void reset() => state = const SearchFilters();
}

final searchFiltersProvider =
    NotifierProvider<SearchFiltersNotifier, SearchFilters>(SearchFiltersNotifier.new);

/// The accumulated search results plus cursor-paging metadata.
@immutable
class SearchState {
  const SearchState({
    this.items = const [],
    this.nextCursor,
    this.hasMore = false,
    this.isLoadingMore = false,
  });

  final List<PublicProfile> items;
  final String? nextCursor;
  final bool hasMore;
  final bool isLoadingMore;

  SearchState copyWith({
    List<PublicProfile>? items,
    String? nextCursor,
    bool? hasMore,
    bool? isLoadingMore,
  }) =>
      SearchState(
        items: items ?? this.items,
        nextCursor: nextCursor,
        hasMore: hasMore ?? this.hasMore,
        isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      );
}

/// Drives `GET /profiles/search`. `build` debounces the watched filters, then
/// loads page one; [loadMore] appends the next cursor page. In-flight requests
/// are cancelled when the filters change (so fast typing doesn't race).
class SearchResultsNotifier extends AsyncNotifier<SearchState> {
  static const _pageSize = 24;
  static const _debounce = Duration(milliseconds: 350);

  CancelToken? _cancelToken;

  @override
  Future<SearchState> build() async {
    final filters = ref.watch(searchFiltersProvider);

    // Abort any request from a previous filter set.
    _cancelToken?.cancel();
    final token = CancelToken();
    _cancelToken = token;
    ref.onDispose(() {
      if (!token.isCancelled) token.cancel();
    });

    // Nothing to search for yet → an empty (non-error) state.
    if (!filters.hasServerCriteria) {
      return const SearchState();
    }

    // Debounce so each keystroke doesn't fire a request. A cancellation during
    // the wait simply abandons this build (a newer one is already running).
    await Future<void>.delayed(_debounce);
    if (token.isCancelled) return const SearchState();

    try {
      final page = await ref.read(searchRepositoryProvider).search(
            q: filters.q.trim().isEmpty ? null : filters.q.trim(),
            gender: filters.gender,
            country: filters.country,
            limit: _pageSize,
            cancelToken: token,
          );
      return SearchState(
        items: page.items,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      );
    } on DioException catch (e) {
      // A superseded request (filters changed) is cancelled — yield an empty
      // state rather than an error; the newer build owns the real result.
      if (e.type == DioExceptionType.cancel) return const SearchState();
      rethrow; // genuine failures surface as AsyncError for the UI.
    }
  }

  /// Append the next page, if any. No-op while loading or exhausted.
  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || !current.hasMore || current.isLoadingMore) return;

    final filters = ref.read(searchFiltersProvider);
    if (!filters.hasServerCriteria) return;

    final token = _cancelToken;
    state = AsyncData(current.copyWith(isLoadingMore: true));
    try {
      final page = await ref.read(searchRepositoryProvider).search(
            q: filters.q.trim().isEmpty ? null : filters.q.trim(),
            gender: filters.gender,
            country: filters.country,
            cursor: current.nextCursor,
            limit: _pageSize,
            cancelToken: token,
          );
      // Guard against a filter change that landed mid-flight.
      if (token != null && token.isCancelled) return;
      state = AsyncData(
        current.copyWith(
          items: [...current.items, ...page.items],
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          isLoadingMore: false,
        ),
      );
    } on DioException catch (e) {
      // A cancellation (filters changed mid-flight) just abandons this page;
      // the rebuilt search already owns the fresh state.
      if (e.type == DioExceptionType.cancel) return;
      _clearLoadingMore(current);
    } on ApiException {
      // Non-fatal: clear the flag so the list stays usable and the user can
      // retry the "load more" affordance.
      _clearLoadingMore(current);
    }
  }

  void _clearLoadingMore(SearchState fallback) {
    final latest = state.value ?? fallback;
    state = AsyncData(latest.copyWith(isLoadingMore: false));
  }
}

final searchResultsProvider =
    AsyncNotifierProvider<SearchResultsNotifier, SearchState>(SearchResultsNotifier.new);
