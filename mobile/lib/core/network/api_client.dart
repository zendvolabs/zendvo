import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'api_exceptions.dart';

/// HTTP client that wraps blockchain submission calls in a resilient
/// retry/error-mapping layer.
///
/// The final XDR submission calls go through [postWithRetry], which:
/// - retries transient failures (timeouts, transport errors, HTTP 5xx/429)
///   with exponential backoff, up to [maxRetries] attempts;
/// - intercepts specific HTTP status codes (e.g. 503 node overload,
///   400 bad signature) and maps them to user-friendly domain exceptions
///   ([NetworkCongestedException], [TransactionFailedException], ...).
class ApiClient {
  ApiClient({
    HttpClient? httpClient,
    this.authTokenProvider,
    this.maxRetries = 3,
    this.baseDelay = const Duration(milliseconds: 500),
    this.maxDelay = const Duration(seconds: 4),
    this.requestTimeout = const Duration(seconds: 15),
  }) : _httpClient = httpClient ?? HttpClient();

  final HttpClient _httpClient;

  /// Provides the current access token for authenticated requests.
  final Future<String?> Function()? authTokenProvider;

  /// Number of submission attempts before giving up.
  final int maxRetries;

  /// Base delay for the exponential backoff between attempts.
  final Duration baseDelay;

  /// Upper bound for the backoff delay.
  final Duration maxDelay;

  /// Per-request timeout; a timeout counts as a transient failure and is
  /// retried.
  final Duration requestTimeout;

  /// HTTP status codes that indicate a transient node/network condition and
  /// are safe to retry.
  static const Set<int> _retryableStatusCodes = {408, 429, 500, 502, 503, 504};

  /// POSTs [body] as JSON to [url], retrying transient failures with
  /// exponential backoff.
///
  /// Throws a mapped domain exception on permanent failure:
  /// - [TransactionFailedException] when the network rejects the transaction
  ///   (HTTP 400, e.g. bad signature);
  /// - [NetworkCongestedException] when retries are exhausted;
  /// - [ApiRequestException] for other unexpected API errors.
  Future<Map<String, dynamic>> postWithRetry(
    String url,
    Map<String, dynamic> body, {
    Map<String, String>? headers,
  }) async {
    var attempt = 0;
    Object? lastError;

    while (attempt < maxRetries) {
      attempt++;
      try {
        return await _postOnce(url, body, headers: headers);
      } on TransactionFailedException {
        // Permanent rejection (bad signature, invalid sequence, etc.) &
        // retrying will not help.
        rethrow;
      } on ApiRequestException {
        // Permanent client error — do not retry.
        rethrow;
      } on NetworkCongestedException catch (error) {
        lastError = error;
      } on IOException catch (error) {
        // Transport-level failure (SocketException, HttpException,
        // HandshakeException, ...) — safe to retry.
        lastError = error;
      } on TimeoutException catch (error) {
        lastError = error;
      }

      if (attempt < maxRetries) {
        await Future<void>.delayed(_backoffDelay(attempt));
      }
    }

    int? lastStatusCode;
    if (lastError is ApiException) {
      lastStatusCode = lastError.statusCode;
    }
    throw NetworkCongestedException(
      'The network is temporarily congested. Please try again shortly.',
      statusCode: lastStatusCode,
      cause: lastError,
    );
  }

  /// Starts a SEP-24 deposit by requesting the interactive anchor URL.
  ///
  /// The [endpointUrl] should point to the backend that initiates the SEP-24
  /// flow. The response is expected to contain the anchor's interactive URL
  /// under the `url` key. Returns that URL so the caller can open it in a
  /// WebView.
  Future<String> startSep24Deposit({
    required String endpointUrl,
    required Map<String, dynamic> depositParams,
    Map<String, String>? headers,
  }) async {
    final response = await postWithRetry(endpointUrl, depositParams, headers: headers);
    final url = response['url'];
    if (url is String && url.isNotEmpty) {
      return url;
    }
    throw ApiRequestException(
      'SEP-24 deposit response did not include an interactive URL.',
      statusCode: null,
    );
  }

  /// Performs a single POST request and maps the response/errors.
  Future<Map<String, dynamic>> _postOnce(
    String url,
    Map<String, dynamic> body, {
    Map<String, String>? headers,
  }) async {
    final uri = Uri.parse(url);
    final request = await _httpClient.postUrl(uri);
    request.headers.contentType = ContentType.json;
    final token = await authTokenProvider?.call();
    if (token != null && token.isNotEmpty) {
      request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
    }
    headers?.forEach((key, value) {
      request.headers.set(key, value);
    });
    request.add(utf8.encode(jsonEncode(body)));

    final response = await request.close().timeout(requestTimeout);
    final responseBody = await response.transform(utf8.decoder).join().timeout(requestTimeout);
    final statusCode = response.statusCode;

    if (statusCode >= 200 && statusCode < 300) {
      return _decodeBody(responseBody);
    }

    final message = _extractMessage(responseBody, statusCode);

    if (statusCode == 400) {
      throw TransactionFailedException(
        message,
        statusCode: statusCode,
      );
    }
    if (statusCode == 409) {
      throw ConflictException(
        message,
        statusCode: statusCode,
      );
    }
    if (_retryableStatusCodes.contains(statusCode)) {
      throw NetworkCongestedException(
        message,
        statusCode: statusCode,
      );
    }
    throw ApiRequestException(
      message,
      statusCode: statusCode,
    );
  }

  /// Decodes a JSON response body, tolerating empty/non-JSON payloads.
  Map<String, dynamic> _decodeBody(String rawBody) {
    if (rawBody.trim().isEmpty) return const {};
    try {
      final decoded = jsonDecode(rawBody);
      if (decoded is Map<String, dynamic>) return decoded;
      return const {};
    } on FormatException {
      return const {};
    }
  }

  /// Extracts a user-friendly message from the error response body.
  String _extractMessage(String rawBody, int statusCode) {
    if (rawBody.trim().isNotEmpty) {
      try {
        final decoded = jsonDecode(rawBody);
        if (decoded is Map<String, dynamic>) {
          final message = decoded['message'] ?? decoded['error'] ?? decoded['detail'];
          if (message is String && message.isNotEmpty) {
            return message;
          }
        }
      } on FormatException {
        // Fall through to the generic message below.
      }
    }
    return 'Request failed with HTTP statusCode.';
  }

  /// Exponential backoff: baseDelay * 2^(attempt-1), capped at [maxDelay].
  Duration _backoffDelay(int attempt) {
    var delayMs = baseDelay.inMilliseconds;
    for (var i = 1; i < attempt; i++) {
      delayMs *= 2;
      if (delayMs >= maxDelay.inMilliseconds) break;
    }
    if (delayMs > maxDelay.inMilliseconds) delayMs = maxDelay.inMilliseconds;
    return Duration(milliseconds: delayMs);
  }

  /// Releases the underlying HTTP client resources.
  void close() {
    _httpClient.close(force: true);
  }
}