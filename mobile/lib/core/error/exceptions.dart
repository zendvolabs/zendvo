class TransactionFailedException implements Exception {
  final String message;
  TransactionFailedException(this.message);

  @override
  String toString() => 'TransactionFailedException: $message';
}

class NetworkCongestedException implements Exception {
  final String message;
  NetworkCongestedException(this.message);

  @override
  String toString() => 'NetworkCongestedException: $message';
}

class BadSignatureException implements Exception {
  final String message;
  BadSignatureException(this.message);

  @override
  String toString() => 'BadSignatureException: $message';
}
