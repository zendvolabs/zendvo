/// Domain exceptions raised by the API client for blockchain interactions.
///
/// These map raw HTTP/transport errors to user-friendly failures that the UI
/// controller can understand and surface to the user.
library;

/// Base class for all API errors surfaced by [ApiClient].
class ApiException implements Exception {
  const ApiException(this.message, {this.statusCode, this.cause});

  /// Human-readable description of the failure.
  final String message;

  /// HTTP status code that triggered the failure, when applicable.
  final int? statusCode;

  /// Underlying error that caused this exception, when applicable.
  final Object? cause;

  @override
  String toString() => '$runtimeType: $message';
}

/// Thrown when the network permanently rejects a transaction, e.g. an
/// HTTP 400 response with a bad signature or invalid sequence number.
class TransactionFailedException extends ApiException {
  const TransactionFailedException(super.message, {super.statusCode, super.cause});
}

/// Thrown when the network or node is overloaded or unreachable and the
/// automatic retries have been exhausted (e.g. HTTP 503 node overload).
class NetworkCongestedException extends ApiException {
  const NetworkCongestedException(super.message, {super.statusCode, super.cause});
}

/// Thrown when a resource conflicts with an existing registration (HTTP 409).
class ConflictException extends ApiException {
  const ConflictException(super.message, {super.statusCode, super.cause});
}

/// Thrown for any other unexpected API failure (e.g. HTTP 404, 422).
class ApiRequestException extends ApiException {
  const ApiRequestException(super.message, {super.statusCode, super.cause});
}

/// Thrown when the vault does not have enough shares or USDC to honour a
/// withdrawal request (HTTP 422 from the backend withdrawal endpoint).
///
/// The UI should surface this as a user-actionable message ("Insufficient
/// vault funds — please try a smaller amount or retry later") rather than a
/// generic network error so the user knows exactly why the operation failed.
class InsufficientVaultFundsException extends ApiException {
  const InsufficientVaultFundsException(super.message, {super.statusCode, super.cause});
}
