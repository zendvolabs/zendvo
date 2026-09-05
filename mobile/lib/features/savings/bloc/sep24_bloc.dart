import 'flutter/foundation.dart';

import '../data/savings_repository.dart';

/// State of the SEP-24 fiat deposit flow.
enum Sep24Status {
  /// Initial state before a deposit is started.
  initial,

  /// Requesting the interactive URL from the backend.
  loading,

  /// The anchor's interactive web page is visible in the in-app WebView.
  webViewOpen,

  /// The anchor indicated the transfer completed successfully.
  success,

  /// The flow failed, either while requesting the URL or during the
  /// anchor interaction.
  error,
}

/// Manages the state machine for the SEP-24 anchor deposit flow.
///
/// The UI listens to [Sep24Bloc] (a [ChangeNotifier]) to show loading
/// indicators, open the WebView, and alert the user on completion or failure.
class Sep24Bloc extends ChangeNotifier {
  Sep24Bloc({required SavingsRepository repository}) : _repository = repository;

  final SavingsRepository _repository;

  Sep24Status _status = Sep24Status.initial;
  Sep24Status get status => _status;

  String? _interactiveUrl;
  String? get interactiveUrl => _interactiveUrl;

  String? _returnUrl;
  String? get returnUrl => _returnUrl;

  String? _errorMessage;
  String? get errorMessage => _errorMessage;

  /// Starts the SEP-24 deposit flow:
  /// captures the input parameters, requests the interactive URL from the
  /// backend, and transitions to [Sep24Status.webViewOpen] when ready.
  Future<void> startSep24Deposit({
    required String amount,
    required String assetCode,
    required String accountId,
    String? email,
  }) async {
    _status = Sep24Status.loading;
    _errorMessage = null;
    notifyListeners();

    try {
      final session = await _repository.startSep24Deposit(
        amount: amount,
        assetCode: assetCode,
        accountId: accountId,
        email: email,
      );
      _interactiveUrl = session.interactiveUrl;
      _returnUrl = session.returnUrl;
      _status = Sep24Status.webViewOpen;
    } catch (error) {
      _status = Sep24Status.error;
      _errorMessage = error.toString();
    }
    notifyListeners();
  }

  /// Called when the WebView attempts to navigate to a URL.
  ///
  /// When the URL matches the SEP-24 return URL, this method inspects the
  /// query parameters to determine whether the transaction succeeded or
  /// failed and updates the state accordingly.
  void handleUrlChange(String url) {
    if (_returnUrl == null || _status != Sep24Status.webViewOpen) return;

    if (url.startsWith(_returnUrl)) {
      final success = _isSuccessUrl(url);
      if (success) {
        _status = Sep24Status.success;
      } else {
        _status = Sep24Status.error;
        _errorMessage = 'The deposit was not completed. Please try again.';
      }
      notifyListeners();
    }
  }

  bool _isSuccessUrl(String url) {
    final normalized = url.toLowerCase();
    return normalized.contains('status=success') ||
        normalized.contains('status=complete') ||
        normalized.contains('transaction_status=success') ||
        normalized.contains('transaction_status=complete');
  }

  /// Resets the flow back to the initial state so it can be started again.
  void reset() {
    _status = Sep24Status.initial;
    _interactiveUrl = null;
    _returnUrl = null;
    _errorMessage = null;
    notifyListeners();
  }
}
