/// Common envelopes mirroring `packages/shared-types/src/common.ts` and the
/// backend's flat list pages (`{ items, nextCursor, hasMore }`).
library;

/// Cursor-paginated list page. The NestJS list endpoints return a FLAT shape
/// (`{ items, nextCursor, hasMore }`), not a nested `meta`, so this mirrors the
/// wire form directly. Generic over the item type with a JSON decoder.
class Paginated<T> {
  const Paginated({
    required this.items,
    required this.nextCursor,
    required this.hasMore,
  });

  final List<T> items;
  final String? nextCursor;
  final bool hasMore;

  factory Paginated.fromJson(
    Map<String, dynamic> json,
    T Function(Map<String, dynamic>) fromItem,
  ) {
    final rawItems = (json['items'] as List?) ?? const [];
    return Paginated<T>(
      items: rawItems
          .map((e) => fromItem(e as Map<String, dynamic>))
          .toList(growable: false),
      nextCursor: json['nextCursor'] as String?,
      hasMore: json['hasMore'] as bool? ?? false,
    );
  }

  static Paginated<T> empty<T>() =>
      Paginated<T>(items: const [], nextCursor: null, hasMore: false);
}

/// `apiErrorSchema` — the standard error body. `message` may be a string or a
/// list of strings (validation errors); both collapse to [message].
class ApiError {
  const ApiError({required this.statusCode, required this.message, this.error});

  final int statusCode;
  final String message;
  final String? error;

  factory ApiError.fromJson(Map<String, dynamic> json) {
    final rawMessage = json['message'];
    final message = rawMessage is List
        ? rawMessage.map((e) => e.toString()).join(', ')
        : (rawMessage?.toString() ?? 'Unknown error');
    return ApiError(
      statusCode: (json['statusCode'] as num?)?.toInt() ?? 0,
      message: message,
      error: json['error'] as String?,
    );
  }
}
