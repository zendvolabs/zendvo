import 'dart:async';

import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exceptions.dart';
import '../data/sep24_repository.dart';
import '../models/sep24_models.dart';
import 'sep24_event.dart';
import 'sep24_state.dart';

export 'sep24_event.dart';
export 'sep24_state.dart';

/// Drives the SEP-24 anchor deposit flow: fiat in, USDC out.
///
/// State machine (see [Sep24State]):
///
/// ```text
///                        ┌───────────────┐
///   StartSep24Deposit ──▶│ Sep24Loading  │  asking the backend for the
///                        └──────┬────────┘  anchor's interactive URL
///        anchor refuses /       │ interactive URL          ┌─────────┐
///        network failure        ▼                          │Sep24Error│
///                  ┌────────────────┐ ──── terminal ─────▶ └─────────┘
///                  │Sep24WebViewOpen│                       ▲        │
///                  └────────────────┘          non-terminal │        │ retry
///                     ▲  │                      callbacks    └────────┘
///                     └──┘
///   any state ──Sep24DepositCancelled / Sep24DepositReset──▶ Sep24Initial
///   WebViewOpen ──status == completed──▶ Sep24Success
/// ```
///
/// Responsibilities:
/// * capture and validate the deposit parameters (amount, asset, user
///   details) and exchange them for the anchor's interactive URL through
///   [Sep24Repository];
/// * hand that URL to the UI so it can open the in-app WebView
///   (`Sep24WebViewPage`);
/// * interpret the URL callbacks/redirections the WebView reports — plus a
///   periodic backend status poll — as transaction status changes;
/// * move to [Sep24Success] or [Sep24Error] so the UI can alert the user.
class Sep24Bloc extends Bloc<Sep24Event, Sep24State> {
  Sep24Bloc({
    required this.repository,
    Sep24CallbackParser? callbackParser,
    this.pollInterval = const Duration(seconds: 15),
    this.enableStatusPolling = true,
    this.onTerminal,
  }) : callbackParser = callbackParser ?? const Sep24CallbackParser(),
       super(const Sep24Initial()) {
    on<StartSep24Deposit>(_onStartDeposit);
    on<Sep24WebViewNavigation>(_onWebViewNavigation);
    on<Sep24StatusRefreshRequested>(_onStatusRefresh);
    on<Sep24DepositCancelled>(_onCancelled);
    on<Sep24DepositReset>(_onReset);
  }

  /// Backend/anchor calls for the SEP-24 flow.
  final Sep24Repository repository;

  /// Recognises status callbacks in the URLs the WebView navigates to.
  final Sep24CallbackParser callbackParser;

  /// How often the backend is polled while the WebView is open.
  final Duration pollInterval;

  /// Whether to poll the backend for status in addition to listening to the
  /// WebView callbacks.
  final bool enableStatusPolling;

  /// Optional hook fired when the flow reaches a terminal state, e.g. to
  /// refresh the savings balance behind the sheet.
  final void Function(Sep24State terminalState)? onTerminal;

  Sep24DepositRequest? _request;
  String? _transactionId;
  Sep24FlowOutcome? _outcome;
  Timer? _pollTimer;
  bool _statusEndpointUnavailable = false;
  bool _pollInFlight = false;

  /// The parameters of the flow currently in flight (or the last one).
  Sep24DepositRequest? get currentRequest => _request;

  /// Anchor transaction id, once known.
  String? get currentTransactionId => _transactionId;

  /// Terminal outcome of the current/last flow, if it has finished.
  Sep24FlowOutcome? get lastOutcome => _outcome;

  /// Whether the periodic status poller is currently running.
  bool get isPollingStatus => _pollTimer != null;

  /// Convenience: start a deposit from raw form values.
  void startDeposit({
    required String amount,
    String asset = Sep24DepositRequest.defaultAsset,
    String? account,
    String? email,
    String? phoneNumber,
    String? countryCode,
    Map<String, String> extraFields = const <String, String>{},
  }) {
    add(
      StartSep24Deposit(
        Sep24DepositRequest(
          amount: amount,
          asset: asset,
          account: account,
          email: email,
          phoneNumber: phoneNumber,
          countryCode: countryCode,
          extraFields: extraFields,
        ),
      ),
    );
  }

  /// Convenience: re-run the last request (e.g. after a transient failure).
  void retry() {
    final request = _request;
    if (request == null) {
      return;
    }
    add(StartSep24Deposit(request));
  }

  /// Convenience: report a URL the WebView tried to load. The bloc blocks the
  /// ones that are SEP-24 status handoffs and ignores ordinary page traffic.
  void reportNavigation(String url) => add(Sep24WebViewNavigation(url));

  /// Convenience: ask the backend for the current status right now.
  void refreshStatus() => add(const Sep24StatusRefreshRequested());

  /// Convenience: the user left the anchor page before finishing.
  void cancelDeposit() => add(const Sep24DepositCancelled());

  /// Convenience: put the machine back to [Sep24Initial].
  void resetFlow() => add(const Sep24DepositReset());

  Future<void> _onStartDeposit(
    StartSep24Deposit event,
    Emitter<Sep24State> emit,
  ) async {
    _stopPolling();
    _statusEndpointUnavailable = false;
    _outcome = null;
    _transactionId = null;
    _pollInFlight = false;

    _request = event.request;

    final validationError = event.request.validationError;
    if (validationError != null) {
      _emitFailure(emit, validationError, recoverable: true);
      return;
    }

    emit(
      Sep24Loading(
        phase: Sep24LoadingPhase.requestingAnchorUrl,
        request: event.request,
        message: 'Contacting the deposit provider…',
      ),
    );

    try {
      final ticket = await repository.requestDepositTicket(event.request);
      if (isClosed) {
        return;
      }

      if (ticket.isRejected) {
        _emitFailure(
          emit,
          ticket.error ?? 'The deposit provider rejected the request.',
        );
        return;
      }

      _transactionId = ticket.transactionId;
      final url = ticket.interactiveUrl;
      if (url == null) {
        // `type: transaction` — the anchor accepted everything and needs no
        // web page; track the transaction to its final status instead.
        await _trackWithoutWebView(emit, ticket);
        return;
      }

      emit(
        Sep24WebViewOpen(
          url: url,
          request: _request,
          transactionId: _transactionId,
          status: ticket.status,
          statusMessage: 'Complete the deposit on the provider page.',
        ),
      );
      _startPolling();
    } on Sep24Exception catch (error, stackTrace) {
      _reportError(error, stackTrace);
      _emitFailure(emit, error.message, recoverable: error.recoverable);
    } on ApiException catch (error, stackTrace) {
      _reportError(error, stackTrace);
      _emitFailure(
        emit,
        _describeApiError(error),
        recoverable: error is NetworkCongestedException,
      );
    } catch (error, stackTrace) {
      _reportError(error, stackTrace);
      _emitFailure(
        emit,
        'Something went wrong while starting the deposit. Please try again.',
      );
    }
  }

  /// Handles every URL the WebView attempts to load.
  Future<void> _onWebViewNavigation(
    Sep24WebViewNavigation event,
    Emitter<Sep24State> emit,
  ) async {
    final callback = callbackParser.tryParse(event.url);
    if (callback == null) {
      // Ordinary anchor navigation: nothing to track, let the WebView load.
      return;
    }
    await _applyCallback(emit, callback, replaceCurrent: false);
  }

  Future<void> _onStatusRefresh(
    Sep24StatusRefreshRequested event,
    Emitter<Sep24State> emit,
  ) => _pollStatus(emit, announce: !event.fromTimer);

  Future<void> _onCancelled(
    Sep24DepositCancelled event,
    Emitter<Sep24State> emit,
  ) async {
    _stopPolling();
    _outcome ??= Sep24FlowOutcome.cancelled;
    if (state != const Sep24Initial()) {
      emit(const Sep24Initial());
    }
  }

  Future<void> _onReset(
    Sep24DepositReset event,
    Emitter<Sep24State> emit,
  ) async {
    _stopPolling();
    _request = null;
    _transactionId = null;
    _outcome = null;
    _statusEndpointUnavailable = false;
    if (state != const Sep24Initial()) {
      emit(const Sep24Initial());
    }
  }

  /// Applies a parsed status callback to the state machine.
  ///
  /// [replaceCurrent] is false for anchor callbacks (the callback *is* the new
  /// status) and true when the status came from our own poll.
  Future<void> _applyCallback(
    Emitter<Sep24State> emit,
    Sep24Callback callback, {
    required bool replaceCurrent,
  }) async {
    final id = callback.transactionId;
    if (id != null && id.isNotEmpty) {
      _transactionId = id;
    }

    switch (callback.outcome) {
      case Sep24FlowOutcome.cancelled:
        _stopPolling();
        _outcome = Sep24FlowOutcome.cancelled;
        emit(const Sep24Initial());
      case Sep24FlowOutcome.success:
        _stopPolling();
        _emitSuccess(emit, callback);
      case Sep24FlowOutcome.failure:
        _stopPolling();
        _emitFailure(
          emit,
          callback.message ??
              callback.status.terminalMessage ??
              'The deposit provider could not complete the transfer.',
          status: callback.status,
        );
      case Sep24FlowOutcome.inProgress:
        final current = state;
        if (current is Sep24WebViewOpen) {
          final next = current.copyWith(
            transactionId: _transactionId,
            status: callback.status,
            statusMessage: callback.displayMessage,
            lastCallback: callback,
            isVerifyingStatus: false,
          );
          if (replaceCurrent || next != current) {
            emit(next);
          }
        }
        _startPolling();
      case Sep24FlowOutcome.pendingConfirmation:
        // The anchor redirected back without a status: it only told the app
        // "the page is done", so confirm with the backend before concluding.
        final resolved = await _fetchStatus();
        if (isClosed) {
          return;
        }
        if (resolved != null) {
          await _applyCallback(emit, resolved, replaceCurrent: true);
          return;
        }
        final current = state;
        if (current is Sep24WebViewOpen) {
          emit(
            current.copyWith(
              transactionId: _transactionId,
              statusMessage:
                  'Waiting for the deposit provider to confirm the transfer.',
              lastCallback: callback,
              isVerifyingStatus: false,
            ),
          );
        }
    }
  }

  /// Resolves a flow the anchor created without an interactive page.
  Future<void> _trackWithoutWebView(
    Emitter<Sep24State> emit,
    Sep24DepositTicket ticket,
  ) async {
    final status = ticket.status;
    if (status.isTerminalSuccess) {
      _emitSuccess(
        emit,
        Sep24Callback(
          uri: Uri.parse('about:blank'),
          transactionId: _transactionId,
          status: status,
          rawStatus: status.rawValue,
          message: ticket.error,
        ),
      );
      return;
    }
    if (status.isTerminalFailure) {
      _emitFailure(
        emit,
        status.terminalMessage ?? 'The deposit failed.',
        status: status,
      );
      return;
    }

    emit(
      Sep24Loading(
        phase: Sep24LoadingPhase.verifyingTransaction,
        request: _request,
        transactionId: _transactionId,
        message: status.label,
      ),
    );
    final resolved = await _fetchStatus();
    if (isClosed) {
      return;
    }
    if (resolved != null) {
      await _applyCallback(emit, resolved, replaceCurrent: true);
      return;
    }
    _emitFailure(
      emit,
      'The deposit was accepted, but its status cannot be checked yet. It '
      'will update once the provider confirms the transfer.',
      status: status,
    );
  }

  Future<void> _pollStatus(
    Emitter<Sep24State> emit, {
    required bool announce,
  }) async {
    final current = state;
    if (current is! Sep24WebViewOpen) {
      return;
    }
    if (announce) {
      emit(current.copyWith(isVerifyingStatus: true));
    }
    final resolved = await _fetchStatus();
    if (isClosed) {
      return;
    }
    if (resolved != null) {
      await _applyCallback(emit, resolved, replaceCurrent: true);
      return;
    }
    final after = state;
    if (after is Sep24WebViewOpen) {
      emit(
        after.copyWith(
          isVerifyingStatus: false,
          statusMessage: _statusEndpointUnavailable
              ? 'Live status is unavailable; the app updates when the '
                    'provider redirects back.'
              : after.statusMessage,
        ),
      );
    }
  }

  /// Reads the transaction status from the backend once.
  ///
  /// Returns `null` when there is nothing to read: no id yet, a request
  /// already in flight, or a backend that does not expose the endpoint — in
  /// which case the WebView callbacks stay the source of truth and the poller
  /// is stopped instead of hammering a missing route.
  Future<Sep24Callback?> _fetchStatus() async {
    final id = _transactionId;
    if (id == null ||
        id.isEmpty ||
        _statusEndpointUnavailable ||
        _pollInFlight) {
      return null;
    }
    _pollInFlight = true;
    try {
      return await repository.fetchTransactionStatus(id);
    } on Sep24StatusUnavailableException {
      _statusEndpointUnavailable = true;
      _stopPolling();
      return null;
    } on Exception catch (error, stackTrace) {
      // Transient: keep the timer alive rather than failing the deposit.
      _reportError(error, stackTrace);
      return null;
    } finally {
      _pollInFlight = false;
    }
  }

  void _emitSuccess(Emitter<Sep24State> emit, Sep24Callback callback) {
    _outcome = Sep24FlowOutcome.success;
    final request = _request;
    emit(
      Sep24Success(
        status: callback.status,
        request: request,
        transactionId: callback.transactionId ?? _transactionId,
        amountIn: callback.amountIn ?? request?.amount,
        assetCode: callback.assetCode ?? request?.asset,
        message: callback.message,
      ),
    );
    _notifyTerminal();
  }

  void _emitFailure(
    Emitter<Sep24State> emit,
    String message, {
    bool recoverable = true,
    Sep24TransactionStatus? status,
  }) {
    _outcome = Sep24FlowOutcome.failure;
    emit(
      Sep24Error(
        message: message,
        request: _request,
        transactionId: _transactionId,
        status: status,
        recoverable: recoverable,
      ),
    );
    _notifyTerminal();
  }

  void _notifyTerminal() {
    onTerminal?.call(state);
  }

  void _startPolling() {
    if (!enableStatusPolling ||
        _statusEndpointUnavailable ||
        _transactionId == null ||
        _pollTimer != null ||
        pollInterval <= Duration.zero) {
      return;
    }
    _pollTimer = Timer.periodic(pollInterval, (timer) {
      if (isClosed) {
        timer.cancel();
        return;
      }
      add(Sep24StatusRefreshRequested(fromTimer: true));
    });
  }

  void _stopPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
  }

  static String _describeApiError(ApiException error) {
    switch (error.statusCode) {
      case 401:
      case 403:
        return 'Please sign in again to start a deposit.';
      case 404:
        return 'Deposits are not available yet: the anchor endpoint is not '
            'configured on this backend.';
      case 429:
        return 'Too many deposit attempts. Please try again shortly.';
      default:
        return error.message;
    }
  }

  void _reportError(Object error, StackTrace stackTrace) {
    if (isClosed) {
      return;
    }
    // Routed through the bloc so a configured BlocObserver/logging layer sees
    // it; the user-facing copy is carried by the Sep24Error state instead.
    addError(error, stackTrace);
  }

  @override
  Future<void> close() {
    _stopPolling();
    return super.close();
  }
}