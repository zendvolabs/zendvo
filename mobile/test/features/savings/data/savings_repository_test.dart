import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/network/api_client.dart';
import 'package:mobile/core/network/api_exceptions.dart';
import 'package:mobile/features/savings/data/savings_repository.dart';

/// Starts a local HTTP server that responds according to [handler].
/// Returns the server and a base URL pointing at it.
Future<(HttpServer, Uri)> startServer(Future<void> Function(HttpRequest) handler) async {
  final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  final baseUri = Uri.parse('http://127.0.0.1:${server.port}');
  server.listen((request) async {
    try {
      await handler(request);
    } catch (e, st) {
      // Close any still-open response, then propagate the error so the
      // test fails immediately rather than hanging as a retry timeout.
      try {
        await request.response.close();
      } catch (_) {}
      Error.throwWithStackTrace(e, st);
    }
  });
  return (server, baseUri);
}

Future<void> jsonResponse(HttpRequest request, int statusCode, Map<String, dynamic> body) async {
  try {
    await request.drain<void>();
  } on StateError {
    // The handler above already consumed the request body to assert on it;
    // draining it a second time throws "Stream has already been listened to".
  }
  request.response
    ..statusCode = statusCode
    ..headers.contentType = ContentType.json
    ..write(jsonEncode(body));
  await request.response.close();
}

void main() {
  group('SavingsRepository.registerStellarAddress', () {
    test('posts the public key to the wallet registration endpoint', () async {
      final (server, baseUri) = await startServer((request) async {
        expect(request.uri.path, '/api/wallet/register');
        final body = await utf8.decoder.bind(request).join();
        expect(jsonDecode(body), {'stellarAddress': 'GABC'});
        expect(request.headers.value(HttpHeaders.authorizationHeader), 'Bearer test-token');
        return jsonResponse(request, 200, {'ok': true});
      });
      addTearDown(() => server.close(force: true));

      final repository = SavingsRepository(
        apiClient: ApiClient(
          authTokenProvider: () async => 'test-token',
          baseDelay: const Duration(milliseconds: 1),
        ),
        baseUrl: baseUri.toString(),
      );

      await repository.registerStellarAddress('GABC');
    });

    test('propagates duplicate address conflicts', () async {
      final (server, baseUri) = await startServer((request) async {
        return jsonResponse(request, 409, {'message': 'address already registered'});
      });
      addTearDown(() => server.close(force: true));

      final repository = SavingsRepository(
        apiClient: ApiClient(baseDelay: const Duration(milliseconds: 1)),
        baseUrl: baseUri.toString(),
      );

      await expectLater(
        repository.registerStellarAddress('GABC'),
        throwsA(isA<ConflictException>()),
      );
    });
  });

  group('SavingsRepository.requestTrustlineXdr', () {
    test('posts the account public key and returns the unsigned XDR', () async {
      final (server, baseUri) = await startServer((request) async {
        expect(request.method, 'POST');
        expect(request.uri.path, '/api/savings/trustline');
        final body = await utf8.decoder.bind(request).join();
        expect(jsonDecode(body), {'accountId': 'GABC'});
        return jsonResponse(request, 200, {'success': true, 'xdr': 'unsigned_trustline_xdr'});
      });
      addTearDown(() => server.close(force: true));

      final repository = SavingsRepository(
        apiClient: ApiClient(baseDelay: const Duration(milliseconds: 1)),
        baseUrl: baseUri.toString(),
      );

      final xdr = await repository.requestTrustlineXdr('GABC');

      expect(xdr, 'unsigned_trustline_xdr');
    });

    test('throws TransactionFailedException when no XDR is returned', () async {
      final (server, baseUri) = await startServer((request) async {
        return jsonResponse(request, 200, {'success': true});
      });
      addTearDown(() => server.close(force: true));

      final repository = SavingsRepository(
        apiClient: ApiClient(baseDelay: const Duration(milliseconds: 1)),
        baseUrl: baseUri.toString(),
      );

      await expectLater(
        repository.requestTrustlineXdr('GABC'),
        throwsA(isA<TransactionFailedException>()),
      );
    });

    test('propagates permanent failures from the backend', () async {
      final (server, baseUri) = await startServer((request) async {
        return jsonResponse(request, 400, {'message': 'No Stellar address registered'});
      });
      addTearDown(() => server.close(force: true));

      final repository = SavingsRepository(
        apiClient: ApiClient(baseDelay: const Duration(milliseconds: 1)),
        baseUrl: baseUri.toString(),
      );

      await expectLater(
        repository.requestTrustlineXdr('GABC'),
        throwsA(isA<TransactionFailedException>()),
      );
    });
  });

  group('SavingsRepository.submitSignedXdr', () {
    test('submits the signed XDR and reports succeeded state with the hash', () async {
      final (server, baseUri) = await startServer((request) async {
        expect(request.uri.path, '/api/transactions/submit');
        final body = await utf8.decoder.bind(request).join();
        expect(jsonDecode(body), {'xdr': 'signed_xdr_envelope'});
        request.response
          ..statusCode = 200
          ..headers.contentType = ContentType.json
          ..write(jsonEncode({'hash': 'tx-hash-123'}));
        await request.response.close();
      });
      addTearDown(() => server.close(force: true));

      final repository = SavingsRepository(
        apiClient: ApiClient(baseDelay: const Duration(milliseconds: 1)),
        baseUrl: baseUri.toString(),
      );

      expect(repository.submissionStatus.value, SavingsSubmissionStatus.idle);

      final hash = await repository.submitSignedXdr('signed_xdr_envelope');

      expect(hash, 'tx-hash-123');
      expect(repository.submissionStatus.value, SavingsSubmissionStatus.succeeded);
    });

    test('transient failures are retried automatically', () async {
      var attempts = 0;
      final (server, baseUri) = await startServer((request) async {
        attempts++;
        if (attempts < 3) {
          return jsonResponse(request, 503, {'message': 'node overloaded'});
        }
        return jsonResponse(request, 200, {'hash': 'tx-hash-456'});
      });
      addTearDown(() => server.close(force: true));

      final repository = SavingsRepository(
        apiClient: ApiClient(baseDelay: const Duration(milliseconds: 1)),
        baseUrl: baseUri.toString(),
      );

      final hash = await repository.submitSignedXdr('signed_xdr_envelope');

      expect(attempts, 3);
      expect(hash, 'tx-hash-456');
      expect(repository.submissionStatus.value, SavingsSubmissionStatus.succeeded);
    });

    test('permanent failure maps to TransactionFailedException and state reverts cleanly', () async {
      final (server, baseUri) = await startServer((request) async {
        return jsonResponse(request, 400, {'message': 'bad signature'});
      });
      addTearDown(() => server.close(force: true));

      final repository = SavingsRepository(
        apiClient: ApiClient(baseDelay: const Duration(milliseconds: 1)),
        baseUrl: baseUri.toString(),
      );

      await expectLater(
        repository.submitSignedXdr('signed_xdr_envelope'),
        throwsA(isA<TransactionFailedException>()),
      );

      // State must not stay stuck in "submitting"/"pending".
      expect(repository.submissionStatus.value, SavingsSubmissionStatus.failed);

      // The user can attempt the action again after resetting the state.
      repository.resetSubmissionState();
      expect(repository.submissionStatus.value, SavingsSubmissionStatus.idle);
    });

    test('congestion after retries maps to NetworkCongestedException and reverts state', () async {
      final (server, baseUri) = await startServer((request) async {
        return jsonResponse(request, 503, {'message': 'node overloaded'});
      });
      addTearDown(() => server.close(force: true));

      final repository = SavingsRepository(
        apiClient: ApiClient(maxRetries: 3, baseDelay: const Duration(milliseconds: 1)),
        baseUrl: baseUri.toString(),
      );

      await expectLater(
        repository.submitSignedXdr('signed_xdr_envelope'),
        throwsA(isA<NetworkCongestedException>()),
      );
      expect(repository.submissionStatus.value, SavingsSubmissionStatus.failed);

      repository.resetSubmissionState();
      expect(repository.submissionStatus.value, SavingsSubmissionStatus.idle);
    });
  });

  group('SavingsRepository.submitWithdrawalXdr', () {
    test('submits the signed XDR and reports succeeded state with the hash', () async {
      final (server, baseUri) = await startServer((request) async {
        expect(request.uri.path, '/api/transactions/submit');
        final body = await utf8.decoder.bind(request).join();
        expect(jsonDecode(body), {'signedXdr': 'signed_withdrawal_xdr'});
        return jsonResponse(request, 200, {'hash': 'withdrawal-tx-hash-001'});
      });
      addTearDown(() => server.close(force: true));

      final repository = SavingsRepository(
        apiClient: ApiClient(baseDelay: const Duration(milliseconds: 1)),
        baseUrl: baseUri.toString(),
      );

      expect(repository.submissionStatus.value, SavingsSubmissionStatus.idle);

      final hash = await repository.submitWithdrawalXdr('signed_withdrawal_xdr');

      expect(hash, 'withdrawal-tx-hash-001');
      expect(repository.submissionStatus.value, SavingsSubmissionStatus.succeeded);
    });

    test('HTTP 422 maps to InsufficientVaultFundsException and reverts state', () async {
      final (server, baseUri) = await startServer((request) async {
        return jsonResponse(request, 422, {'message': 'Insufficient vault funds'});
      });
      addTearDown(() => server.close(force: true));

      final repository = SavingsRepository(
        apiClient: ApiClient(baseDelay: const Duration(milliseconds: 1)),
        baseUrl: baseUri.toString(),
      );

      await expectLater(
        repository.submitWithdrawalXdr('signed_withdrawal_xdr'),
        throwsA(
          isA<InsufficientVaultFundsException>().having(
            (e) => e.statusCode,
            'statusCode',
            422,
          ),
        ),
      );

      expect(repository.submissionStatus.value, SavingsSubmissionStatus.failed);

      repository.resetSubmissionState();
      expect(repository.submissionStatus.value, SavingsSubmissionStatus.idle);
    });

    test('HTTP 400 maps to TransactionFailedException and reverts state', () async {
      final (server, baseUri) = await startServer((request) async {
        return jsonResponse(request, 400, {'message': 'bad XDR signature'});
      });
      addTearDown(() => server.close(force: true));

      final repository = SavingsRepository(
        apiClient: ApiClient(baseDelay: const Duration(milliseconds: 1)),
        baseUrl: baseUri.toString(),
      );

      await expectLater(
        repository.submitWithdrawalXdr('signed_withdrawal_xdr'),
        throwsA(isA<TransactionFailedException>()),
      );

      expect(repository.submissionStatus.value, SavingsSubmissionStatus.failed);

      repository.resetSubmissionState();
      expect(repository.submissionStatus.value, SavingsSubmissionStatus.idle);
    });

    test('transient failures are retried and succeed on recovery', () async {
      var attempts = 0;
      final (server, baseUri) = await startServer((request) async {
        attempts++;
        if (attempts < 3) {
          return jsonResponse(request, 503, {'message': 'node overloaded'});
        }
        return jsonResponse(request, 200, {'hash': 'withdrawal-tx-hash-002'});
      });
      addTearDown(() => server.close(force: true));

      final repository = SavingsRepository(
        apiClient: ApiClient(maxRetries: 3, baseDelay: const Duration(milliseconds: 1)),
        baseUrl: baseUri.toString(),
      );

      final hash = await repository.submitWithdrawalXdr('signed_withdrawal_xdr');

      expect(attempts, 3);
      expect(hash, 'withdrawal-tx-hash-002');
      expect(repository.submissionStatus.value, SavingsSubmissionStatus.succeeded);
    });

    test('congestion after retries maps to NetworkCongestedException and reverts state', () async {
      final (server, baseUri) = await startServer((request) async {
        return jsonResponse(request, 503, {'message': 'node overloaded'});
      });
      addTearDown(() => server.close(force: true));

      final repository = SavingsRepository(
        apiClient: ApiClient(maxRetries: 3, baseDelay: const Duration(milliseconds: 1)),
        baseUrl: baseUri.toString(),
      );

      await expectLater(
        repository.submitWithdrawalXdr('signed_withdrawal_xdr'),
        throwsA(isA<NetworkCongestedException>()),
      );
      expect(repository.submissionStatus.value, SavingsSubmissionStatus.failed);

      repository.resetSubmissionState();
      expect(repository.submissionStatus.value, SavingsSubmissionStatus.idle);
    });

    test('missing hash in success response throws TransactionFailedException', () async {
      final (server, baseUri) = await startServer((request) async {
        return jsonResponse(request, 200, {'success': true});
      });
      addTearDown(() => server.close(force: true));

      final repository = SavingsRepository(
        apiClient: ApiClient(baseDelay: const Duration(milliseconds: 1)),
        baseUrl: baseUri.toString(),
      );

      await expectLater(
        repository.submitWithdrawalXdr('signed_withdrawal_xdr'),
        throwsA(
          isA<TransactionFailedException>().having(
            (e) => e.message,
            'message',
            contains('did not return a transaction hash'),
          ),
        ),
      );
      expect(repository.submissionStatus.value, SavingsSubmissionStatus.failed);
    });
  });

  group('SavingsRepository.requestWithdrawalXdr', () {
    test('requests unsigned withdrawal XDR from backend', () async {
      final (server, baseUri) = await startServer((request) async {
        expect(request.uri.path, '/api/wallet/withdraw');
        final body = await utf8.decoder.bind(request).join();
        expect(jsonDecode(body), {'amount': '100.0', 'accountId': 'GXYZ'});
        return jsonResponse(request, 200, {'unsignedxdr': 'unsigned_withdrawal_xdr'});
      });
      addTearDown(() => server.close(force: true));

      final repository = SavingsRepository(
        apiClient: ApiClient(baseDelay: const Duration(milliseconds: 1)),
        baseUrl: baseUri.toString(),
      );

      final xdr = await repository.requestWithdrawalXdr('100.0', 'GXYZ');

      expect(xdr, 'unsigned_withdrawal_xdr');
    });

    test('throws TransactionFailedException when unsignedxdr is missing', () async {
      final (server, baseUri) = await startServer((request) async {
        return jsonResponse(request, 200, {'success': true});
      });
      addTearDown(() => server.close(force: true));

      final repository = SavingsRepository(
        apiClient: ApiClient(baseDelay: const Duration(milliseconds: 1)),
        baseUrl: baseUri.toString(),
      );

      await expectLater(
        repository.requestWithdrawalXdr('100.0', 'GXYZ'),
        throwsA(
          isA<TransactionFailedException>().having(
            (e) => e.message,
            'message',
            contains('did not return a withdrawal XDR'),
          ),
        ),
      );
    });

    test('propagates network errors', () async {
      final (server, baseUri) = await startServer((request) async {
        return jsonResponse(request, 500, {'message': 'server error'});
      });
      addTearDown(() => server.close(force: true));

      final repository = SavingsRepository(
        apiClient: ApiClient(baseDelay: const Duration(milliseconds: 1)),
        baseUrl: baseUri.toString(),
      );

      await expectLater(
        repository.requestWithdrawalXdr('100.0', 'GXYZ'),
        throwsA(isA<ApiException>()),
      );
    });
  });
}
