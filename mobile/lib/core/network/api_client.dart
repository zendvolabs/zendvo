import 'dart:async';
import 'dart:math';
import '../error/exceptions.dart';

// Placeholder: API Client
// Wraps HTTP requests with retry and error mapping logic for blockchain interactions.
class ApiClient {
  Future<dynamic> postWithRetry(String url, Map<String, dynamic> body, {int maxRetries = 3}) async {
    int attempts = 0;
    
    while (attempts <= maxRetries) {
      try {
        // TODO: Replace with actual HTTP client post call (e.g. http.post or dio.post)
        // final response = await httpClient.post(url, body);
        final response = await _mockHttpPost(url, body);
        final statusCode = response['statusCode'] as int;

        if (statusCode >= 200 && statusCode < 300) {
          return response['body'];
        }

        if (statusCode == 503) {
          throw NetworkCongestedException('Node overload or temporary network failure (503).');
        } else if (statusCode == 400) {
          throw BadSignatureException('Bad signature or malformed request (400).');
        } else {
          throw TransactionFailedException('Transaction failed with status code: $statusCode');
        }
      } catch (e) {
        // If it's a BadSignatureException, we shouldn't retry because the signature will remain invalid.
        if (e is BadSignatureException) {
          rethrow;
        }

        if (attempts >= maxRetries) {
          // Permanent failure after max retries
          if (e is NetworkCongestedException || e is TransactionFailedException) {
            rethrow;
          }
          throw TransactionFailedException('Permanent failure after ${maxRetries + 1} attempts: $e');
        }

        attempts++;
        // Exponential backoff: 2^attempts seconds (2, 4, 8)
        final delaySeconds = pow(2, attempts).toInt();
        await Future.delayed(Duration(seconds: delaySeconds));
      }
    }
  }

  // Mocking an HTTP response for the placeholder.
  Future<Map<String, dynamic>> _mockHttpPost(String url, Map<String, dynamic> body) async {
    return {
      'statusCode': 200,
      'body': {'status': 'success'}
    };
  }
}
