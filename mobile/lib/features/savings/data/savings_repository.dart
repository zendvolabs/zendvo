import 'flutter/foundation.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../models/savings_data_model.dart';

/// Lifecycle of a savings transaction submission, used by UI controllers to
/// render the correct state and to revert cleanly after a permanent failure
/// instead of looping in a "pending" state.
enum SavingsSubmissionStatus {
  /// No submission is in flight.
  idle,

  /// The signed XDR is being submitted to the network.
  submitting,

  /// The submission succeeded and a transaction hash was returned.
  succeeded,

  /// The submission failed permanently; the user can retry.
  failed,
}

/// Handles API interactions for deposits, withdrawals, and polling balance.
///
/// All final XDR submission calls go through [ApiClient.postWithRetry], which
/// retries transient network failures with exponential backoff and maps
/// permanent failures to domain exceptions ([TransactionFailedException],
/// [NetworkCongestedException]) that UI controllers can surface to the user.
class SavingsRepository {
  SavingsRepository({
    ApiClient? apiClient,
    String? baseUrl,
  })  : _apiClient = apiClient ?? ApiClient(),
        _baseUrl = baseUrl ?? defaultBaseUrl;

  /// Backend base URL; override with `--dart-define=API_BASE_URL=`.
  static const String defaultBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:5000',
  );

  final ApiClient _apiClient;
  final String _baseUrl;

  /// Observable submission state. Listen to this to drive button/loading
  /// state and to reset out of a pending state on failure.
  final ValueNotifier<SavingsSubmissionStatus> submissionStatus =
      ValueNotifier<SavingsSubmissionStatus>(SavingsSubmissionStatus.idle);

  /// Requests an unsigned deposit XDR envelope from the backend for the
  /// given [amount] and [accountId].
  ///
  /// Domain exceptions from [ApiClient.postWithRetry] (e.g.
  /// [TransactionFailedException], [NetworkCongestedException]) are
  /// rethrown so the caller/UI controller can handle them; this keeps app
  /// state from getting stuck after a permanent failure.
  Future<String> requestDepositXdr<(String amount, String accountId) async {
    try {
      final response = await _apiClient.postWithRetry(
        '$_baseUrl/api/savings/deposit',
        {'amount': amount, 'accountId': accountId},
      );

      final xdr = response['xdr'] as String?;
      if (xdr == null || xdr.isEmpty) {
        throw const TransactionFailedException(
          'The network accepted the request but did not return a deposit XDR.',
        );
      }
      return xdr;
    } catch (e) {
      // Re-throw domain exceptions so the UI controller can catch and handle
      // them properly, keeping app state from looping in "pending".
      rethrow;
    }
  }

  /// Submits a signed XDR envelope to the backend relay with automatic
  /// retries for transient network failures.
  ///
  /// On success returns the on-chain transaction hash and flips the
  /// submission state to [SavingsSubmissionStatus.succeeded]. On permanent
  /// failure the state reverts to [SavingsSubmissionStatus.failed] and the
  /// mapped domain exception is rethrown so the caller can inform the user;
  /// call [resetSubmissionState] before attempting the action again.
  Future<String> submitSignedXdr(String signedXdr) async {
    submissionStatus.value = SavingsSubmissionStatus.submitting;
    try {
      final response = await _apiClient.postWithRetry(
        '$_baseUrl/api/transactions/submit',
        {'xdr': signedXdr},
      );
      final hash = response['hash'] as String?;
      if (hash == null || hash.isEmpty) {
        throw const TransactionFailedException(
          'The network accepted the transaction but did not return a hash.',
        );
      }
      submissionStatus.value = SavingsSubmissionStatus.succeeded;
      return hash;
    } on ApiException {
      submissionStatus.value = SavingsSubmissionStatus.failed;
      rethrow;
    } catch (error) {
      submissionStatus.value = SavingsSubmissionStatus.failed;
      throw TransactionFailedException(
        'Failed to submit the transaction. Please try again.',
        cause: error,
      );
    }
  }

  /// Reverts the submission state to idle so the user can attempt the action
  /// again without being stuck in a looping "pending" state.
  void resetSubmissionState() {
    submissionStatus.value = SavingsSubmissionStatus.idle;
  }

  /// Registers a newly generated Stellar public key with the backend.
  ///
  /// Authentication is supplied by [ApiClient.authTokenProvider]. A duplicate
  /// address is surfaced as [ConflictException] rather than being retried.
  Future<void> registerStellarAddress(String stellarAddress) async {
    if (stellarAddress.trim().isEmpty) {
      throw ArgumentError.value(stellarAddress, 'stellarAddress', 'Cannot be empty.');
    }

    await _apiClient.postWithRetry(
      '$_baseUrl/api/wallet/register',
      {'stellarAddress': stellarAddress},
    );
  }

  Future<SavingsDataModel> fetchSavingsDashboardData(String accountId) async {
    // TODO: Call backend balance/apy endpoint via _apiClient.postWithRetry.
    return SavingsDataModel(balance: '0.0', apy: '0.0');
  }

  /// Begins a SEP-24 fiat-to-USDC deposit by asking the backend for an
  /// interactive anchor session.
  ///
  /// The backend returns the [Sep24DepositSession] containing the anchor's
  /// interactive URL and the return URL that the anchor will redirect to
  /// after the user finishes the flow.
  Future<Sep24DepositSession> startSep24Deposit({
    required String amount,
    required String assetCode,
    required String accountId,
    String? email,
  }) async {
    try {
      final response = await _apiClient.postWithRetry(
        '$_baseUrl/api/savings/sep24/deposit',
        {
          'amount': amount,
          'assetCode': assetCode,
          'accountId': accountId,
          if (email != null) 'email': email,
        },
      );

      final interactiveUrl = response['interactiveUrl'] as String?;
      final returnUrl = response['returnUrl'] as String?;
      if (interactiveUrl == null || interactiveUrl.isEmpty ||
          returnUrl == null || returnUrl.isEmpty) {
        throw const TransactionFailedException(
          'The network accepted the request but did not return a complete SEP-24 session.',
        );
      }
      return Sep24DepositSession(
        interactiveUrl: interactiveUrl,
        returnUrl: returnUrl,
      );
    } catch (e) {
      rethrow;
    }
  }
}

/// Holds the URLs returned by the backend for a SEP-24 deposit session.
class Sep24DepositSession {
  const Sep24DepositSession({
    required this.interactiveUrl,
    required this.returnUrl,
  });

  /// The anchor's interactive URL to be opened in an in-app WebView.
  final String interactiveUrl;

  /// The URL the anchor redirects to when the transaction flow completes.
  final String returnUrl;
}
