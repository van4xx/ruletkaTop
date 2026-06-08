import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:http_parser/http_parser.dart';

import '../models/models.dart';
import 'api_config.dart';
import 'token_store.dart';

/// A typed error thrown for any non-2xx API response (and network failures),
/// carrying the parsed [ApiError] body when present. UI/feature code should
/// catch this to surface [message].
class ApiException implements Exception {
  ApiException(this.statusCode, this.message, {this.body});

  /// HTTP status, or `0` for a transport-level failure (offline, timeout).
  final int statusCode;
  final String message;
  final ApiError? body;

  bool get isUnauthorized => statusCode == 401;
  bool get isForbidden => statusCode == 403;
  bool get isNetwork => statusCode == 0;

  @override
  String toString() => 'ApiException($statusCode): $message';
}

/// Thin, typed wrapper over Dio for the ruletka.top REST API.
///
/// Responsibilities:
///  * Inject `Authorization: Bearer <accessToken>` from the in-memory
///    [TokenStore] on every request (unless `skipAuth`).
///  * On a `401`, transparently refresh the access token ONCE (single-flight,
///    shared across concurrent 401s) using the secure-storage refresh token in
///    the request body, then retry the original request.
///  * Normalize errors into [ApiException].
///
/// Typed endpoint groups live in `endpoints.dart` (an extension on this class).
class ApiClient {
  ApiClient(this.tokens) : _dio = _createDio() {
    _dio.interceptors.add(
      InterceptorsWrapper(onRequest: _onRequest, onError: _onError),
    );
    if (kDebugMode) {
      _dio.interceptors.add(LogInterceptor(
        requestBody: false,
        responseBody: false,
        requestHeader: false,
        responseHeader: false,
        logPrint: (o) => debugPrint('[api] $o'),
      ));
    }
  }

  final TokenStore tokens;
  final Dio _dio;

  /// Marker on requests that must NOT carry a bearer token (login/register/
  /// refresh) and must NOT trigger the 401-refresh retry.
  static const _skipAuthKey = 'skipAuth';

  /// Marker preventing a retried request from looping into another refresh.
  static const _retriedKey = 'retried';

  static Dio _createDio() => Dio(
        BaseOptions(
          baseUrl: ApiConfig.baseUrl,
          connectTimeout: ApiConfig.connectTimeout,
          receiveTimeout: ApiConfig.receiveTimeout,
          contentType: Headers.jsonContentType,
          // We inspect/normalize all non-2xx ourselves.
          validateStatus: (status) => status != null && status >= 200 && status < 300,
        ),
      );

  // ───────────────────────────── Interceptors ─────────────────────────────
  void _onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final skipAuth = options.extra[_skipAuthKey] == true;
    if (!skipAuth) {
      final access = tokens.accessToken;
      if (access != null && access.isNotEmpty) {
        options.headers['Authorization'] = 'Bearer $access';
      }
    }
    handler.next(options);
  }

  Future<void> _onError(DioException err, ErrorInterceptorHandler handler) async {
    final response = err.response;
    final requestOptions = err.requestOptions;
    final skipAuth = requestOptions.extra[_skipAuthKey] == true;
    final alreadyRetried = requestOptions.extra[_retriedKey] == true;

    // Attempt a single transparent refresh + retry on 401.
    if (response?.statusCode == 401 && !skipAuth && !alreadyRetried) {
      final refreshed = await _refreshToken();
      if (refreshed) {
        try {
          final retried = await _retry(requestOptions);
          return handler.resolve(retried);
        } on DioException catch (e) {
          return handler.reject(e);
        }
      }
    }
    handler.next(err);
  }

  /// Re-issue a request after a successful token refresh (bearer is re-applied
  /// by [_onRequest]; the retry flag prevents a refresh loop).
  Future<Response<dynamic>> _retry(RequestOptions options) {
    final extra = Map<String, dynamic>.from(options.extra)..[_retriedKey] = true;
    return _dio.request<dynamic>(
      options.path,
      data: options.data,
      queryParameters: options.queryParameters,
      cancelToken: options.cancelToken,
      options: Options(
        method: options.method,
        headers: options.headers,
        extra: extra,
        responseType: options.responseType,
        contentType: options.contentType,
      ),
    );
  }

  // ───────────────────────── Single-flight refresh ────────────────────────
  Future<bool>? _refreshInFlight;

  /// Exchange the stored refresh token for a fresh access token. Concurrent
  /// callers share one round-trip. On any failure the tokens are cleared and
  /// `false` is returned (the caller's 401 then propagates → logout).
  Future<bool> _refreshToken() {
    return _refreshInFlight ??= _doRefresh().whenComplete(() {
      _refreshInFlight = null;
    });
  }

  Future<bool> _doRefresh() async {
    final refreshToken = await tokens.readRefreshToken();
    if (refreshToken == null) {
      await tokens.clear();
      return false;
    }
    try {
      // Bare Dio (no interceptors) so this never recurses through _onError.
      final res = await Dio(_dio.options).post<Map<String, dynamic>>(
        '/auth/refresh',
        data: {'refreshToken': refreshToken},
      );
      final data = res.data;
      if (res.statusCode == 200 && data != null && data['tokens'] != null) {
        final newTokens = AuthTokens.fromJson(data['tokens'] as Map<String, dynamic>);
        // Persist the new access token (memory). If the backend rotated the
        // refresh token in the body, persist that too; otherwise keep the old.
        tokens.setAccessToken(newTokens.accessToken);
        if (newTokens.refreshToken.isNotEmpty) {
          await tokens.persist(newTokens);
        }
        return newTokens.accessToken.isNotEmpty;
      }
      await tokens.clear();
      return false;
    } catch (_) {
      await tokens.clear();
      return false;
    }
  }

  /// Public boot hook: try to mint an access token from the stored refresh
  /// token (there is no persisted access token to restore). Returns `true`
  /// when a session was re-established.
  Future<bool> tryRestoreSession() => _refreshToken();

  // ─────────────────────────── Core verbs (typed) ─────────────────────────
  /// GET → decode the JSON object body with [decoder].
  Future<T> getJson<T>(
    String path,
    T Function(Map<String, dynamic>) decoder, {
    Map<String, dynamic>? query,
    bool skipAuth = false,
    CancelToken? cancelToken,
  }) async {
    final res = await _send(
      () => _dio.get<dynamic>(path,
          queryParameters: query,
          cancelToken: cancelToken,
          options: _opts(skipAuth)),
    );
    return decoder(_asMap(res.data));
  }

  /// GET → decode a JSON array body, mapping each element with [decoder].
  Future<List<T>> getList<T>(
    String path,
    T Function(Map<String, dynamic>) decoder, {
    Map<String, dynamic>? query,
    Map<String, dynamic>? headers,
    bool skipAuth = false,
    CancelToken? cancelToken,
  }) async {
    final res = await _send(
      () => _dio.get<dynamic>(path,
          queryParameters: query,
          cancelToken: cancelToken,
          options: _opts(skipAuth, headers: headers)),
    );
    final data = res.data;
    if (data is! List) return <T>[];
    return data
        .map((e) => decoder(e as Map<String, dynamic>))
        .toList(growable: false);
  }

  /// GET → a cursor-paginated page (`{ items, nextCursor, hasMore }`).
  Future<Paginated<T>> getPage<T>(
    String path,
    T Function(Map<String, dynamic>) decoder, {
    String? cursor,
    int? limit,
    Map<String, dynamic>? extraQuery,
    CancelToken? cancelToken,
  }) async {
    final query = <String, dynamic>{
      'cursor': ?cursor,
      'limit': ?limit,
      ...?extraQuery,
    };
    final res = await _send(
      () => _dio.get<dynamic>(path,
          queryParameters: query.isEmpty ? null : query,
          cancelToken: cancelToken,
          options: _opts(false)),
    );
    return Paginated<T>.fromJson(_asMap(res.data), decoder);
  }

  /// POST/PATCH/PUT with a JSON body → decode the JSON object response.
  Future<T> sendJson<T>(
    String method,
    String path,
    T Function(Map<String, dynamic>) decoder, {
    Object? body,
    Map<String, dynamic>? query,
    bool skipAuth = false,
    CancelToken? cancelToken,
  }) async {
    final res = await _send(
      () => _dio.request<dynamic>(
        path,
        data: body,
        queryParameters: query,
        cancelToken: cancelToken,
        options: _opts(skipAuth, method: method),
      ),
    );
    return decoder(_asMap(res.data));
  }

  /// POST/PATCH/DELETE with no meaningful response body (204 or ignored).
  Future<void> sendVoid(
    String method,
    String path, {
    Object? body,
    Map<String, dynamic>? query,
    Map<String, dynamic>? headers,
    bool skipAuth = false,
    CancelToken? cancelToken,
  }) async {
    await _send(
      () => _dio.request<dynamic>(
        path,
        data: body,
        queryParameters: query,
        cancelToken: cancelToken,
        options: _opts(skipAuth, method: method, headers: headers),
      ),
    );
  }

  /// POST a single-file `multipart/form-data` body (e.g. the avatar upload) →
  /// decode the JSON object response. The bytes ride under [field] with the
  /// given [filename] + optional [mimeType]; the bearer token is attached as
  /// usual (so the 401-refresh-retry still applies on the first attempt).
  Future<T> uploadMultipart<T>(
    String path,
    T Function(Map<String, dynamic>) decoder, {
    required List<int> bytes,
    required String field,
    required String filename,
    String? mimeType,
    CancelToken? cancelToken,
  }) async {
    final form = FormData.fromMap({
      field: MultipartFile.fromBytes(
        bytes,
        filename: filename,
        contentType: mimeType != null ? MediaType.parse(mimeType) : null,
      ),
    });
    final res = await _send(
      () => _dio.post<dynamic>(
        path,
        data: form,
        cancelToken: cancelToken,
        // Let Dio set the multipart boundary content-type for the FormData.
        options: Options(method: 'POST', contentType: null),
      ),
    );
    return decoder(_asMap(res.data));
  }

  Options _opts(bool skipAuth, {String? method, Map<String, dynamic>? headers}) => Options(
        method: method,
        headers: headers,
        extra: {if (skipAuth) _skipAuthKey: true},
      );

  /// Run a Dio call, translating [DioException]/unexpected errors into
  /// [ApiException]. Rethrows [CancelToken] cancellations untouched.
  Future<Response<dynamic>> _send(Future<Response<dynamic>> Function() run) async {
    try {
      return await run();
    } on DioException catch (e) {
      if (e.type == DioExceptionType.cancel) rethrow;
      throw _toApiException(e);
    }
  }

  ApiException _toApiException(DioException e) {
    final res = e.response;
    if (res != null) {
      ApiError? body;
      if (res.data is Map<String, dynamic>) {
        body = ApiError.fromJson(res.data as Map<String, dynamic>);
      }
      final message = body?.message ?? _statusMessage(res.statusCode);
      return ApiException(res.statusCode ?? 0, message, body: body);
    }
    // Transport-level (no response): offline, DNS, timeout, connection reset.
    final msg = switch (e.type) {
      DioExceptionType.connectionTimeout ||
      DioExceptionType.sendTimeout ||
      DioExceptionType.receiveTimeout =>
        'Превышено время ожидания сети',
      DioExceptionType.connectionError => 'Нет соединения с сервером',
      _ => 'Сетевая ошибка',
    };
    return ApiException(0, msg);
  }

  String _statusMessage(int? status) => switch (status) {
        400 => 'Неверный запрос',
        401 => 'Требуется вход',
        403 => 'Доступ запрещён',
        404 => 'Не найдено',
        409 => 'Конфликт',
        429 => 'Слишком много запросов',
        500 || 502 || 503 => 'Ошибка сервера',
        _ => 'Что-то пошло не так',
      };

  Map<String, dynamic> _asMap(dynamic data) {
    if (data is Map<String, dynamic>) return data;
    return <String, dynamic>{};
  }
}
