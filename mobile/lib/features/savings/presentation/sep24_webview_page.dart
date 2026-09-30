import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../bloc/sep24_bloc.dart';

/// Moments of a WebView navigation the SEP-24 page cares about.
enum Sep24NavigationPhase {
  /// A navigation is about to happen and can still be blocked.
  willLoad,

  /// The page started loading.
  started,

  /// The page finished loading.
  finished,
}

/// Reports a WebView navigation to the app and returns whether the app
/// consumed it (i.e. the WebView must **not** navigate).
typedef Sep24NavigationCallback =
    FutureOr<bool> Function(String url, Sep24NavigationPhase phase);

/// What a widget rendering the anchor's interactive page needs.
@immutable
class Sep24WebViewRequest {
  const Sep24WebViewRequest({
    required this.url,
    required this.onNavigation,
    this.showProgressBar = true,
  });

  /// The anchor's SEP-24 interactive URL.
  final Uri url;

  /// Callback invoked for every navigation attempt.
  final Sep24NavigationCallback onNavigation;

  /// Whether the platform view should draw its own load progress bar.
  final bool showProgressBar;

  @override
  String toString() => 'Sep24WebViewRequest($url)';
}

/// Builds the in-app web view. Injectable so the page's state machine can be
/// widget-tested without a platform WebView implementation.
typedef Sep24WebViewFactory =
    Widget Function(BuildContext context, Sep24WebViewRequest request);

/// The in-app WebView page for the anchor's SEP-24 interactive flow.
///
/// The page is deliberately dumb: it renders [Sep24State] from [bloc],
/// forwards every navigation the platform WebView reports back to the bloc,
/// and lets the bloc decide which of those are transaction status callbacks.
/// When the bloc reaches a terminal state the page alerts the user (snackbar +
/// banner) and pops with the resulting [Sep24State].
class Sep24WebViewPage extends StatefulWidget {
  const Sep24WebViewPage({
    super.key,
    required this.bloc,
    this.webViewFactory = defaultSep24WebViewFactory,
    this.title = 'Complete your deposit',
    this.popOnSuccess = true,
    this.successCloseDelay = const Duration(milliseconds: 600),
  });

  /// State machine driving the deposit.
  final Sep24Bloc bloc;

  /// Renderer for the anchor page; override in tests.
  final Sep24WebViewFactory webViewFactory;

  final String title;

  /// Whether to dismiss the page once the deposit completes.
  final bool popOnSuccess;

  /// Grace period before closing on success, so the anchor's "done" screen is
  /// visible for a moment.
  final Duration successCloseDelay;

  @override
  State<Sep24WebViewPage> createState() => _Sep24WebViewPageState();
}

class _Sep24WebViewPageState extends State<Sep24WebViewPage> {
  Widget? _webView;
  Uri? _webViewUrl;
  String? _lastHandledCallback;
  bool _didPop = false;
  Timer? _closeTimer;
  Sep24State? _pendingResult;

  Sep24Bloc get _bloc => widget.bloc;

  @override
  void dispose() {
    final state = _bloc.state;
    if (!_bloc.isClosed &&
        (state is Sep24WebViewOpen || state is Sep24Loading)) {
      // The page went away mid-flow (system back, programmatic pop, ...):
      // abandon the flow so the bloc stops polling for a page that is gone.
      _bloc.cancelDeposit();
    }
    _closeTimer?.cancel();
    super.dispose();
  }

  /// Builds (once per URL) the widget that hosts the anchor page.
  Widget? _webViewFor(Sep24State state) {
    if (state is! Sep24WebViewOpen) {
      return null;
    }
    if (_webView != null && _webViewUrl == state.url) {
      return _webView;
    }
    _webViewUrl = state.url;
    _webView = widget.webViewFactory(
      context,
      Sep24WebViewRequest(url: state.url, onNavigation: _handleNavigation),
    );
    return _webView;
  }

  /// Intercepts anchor redirects that are really status handoffs.
  ///
  /// Returns `true` when the WebView must *not* navigate because the URL was a
  /// status callback: the bloc consumes it and drives the state machine.
  bool _handleNavigation(String url, Sep24NavigationPhase phase) {
    final isStatusCallback = _bloc.callbackParser.tryParse(url) != null;
    if (!isStatusCallback) {
      return false;
    }
    if (_lastHandledCallback == url) {
      // Already consumed this handoff (a blocked redirect is typically
      // reported again by `onPageStarted`/`onPageFinished`).
      return true;
    }
    _lastHandledCallback = url;
    _bloc.reportNavigation(url);
    return true;
  }

  /// Alerts the UI on the transitions the user cares about.
  void _onStateChanged(Sep24State next) {
    switch (next) {
      case Sep24Success():
        _notify('Deposit complete', next.userMessage, isError: false);
        if (widget.popOnSuccess) {
          _closeWithResult(next, delay: widget.successCloseDelay);
        }
      case Sep24Error():
        _notify('Deposit failed', next.message, isError: true);
      case Sep24Initial():
        // The user walked away (or the flow was reset) — leave the page.
        _closeWithResult(_pendingResult ?? next);
      case Sep24Loading():
      case Sep24WebViewOpen():
        break;
    }
  }

  void _notify(String label, String message, {required bool isError}) {
    if (!mounted) {
      return;
    }
    final messenger = ScaffoldMessenger.maybeOf(context);
    messenger?.showSnackBar(
      SnackBar(
        content: Text('$label: $message'),
        behavior: SnackBarBehavior.floating,
        showCloseIcon: true,
        duration: isError
            ? const Duration(seconds: 6)
            : const Duration(seconds: 4),
        backgroundColor: isError ? Theme.of(context).colorScheme.error : null,
      ),
    );
  }

  void _closeWithResult(Sep24State result, {Duration? delay}) {
    if (_didPop) {
      return;
    }
    if (delay != null && delay > Duration.zero) {
      _closeTimer?.cancel();
      _closeTimer = Timer(delay, () => _pop(result));
      return;
    }
    _pop(result);
  }

  void _pop(Sep24State result) {
    _closeTimer?.cancel();
    _closeTimer = null;
    if (!mounted || _didPop) {
      return;
    }
    _didPop = true;
    Navigator.of(context).pop(result);
  }

  /// The user pressed back / tapped close before the anchor finished.
  void _handleUserClose() {
    final state = _bloc.state;
    if (state is Sep24WebViewOpen || state is Sep24Loading) {
      // Remember what the caller should see, then let the bloc's
      // Sep24Initial transition close the page.
      _pendingResult = state;
      _bloc.cancelDeposit();
      return;
    }
    _closeWithResult(state);
  }

  @override
  Widget build(BuildContext context) {
    return BlocListener<Sep24Bloc, Sep24State>(
      bloc: _bloc,
      listener: (context, next) => _onStateChanged(next),
      child: BlocBuilder<Sep24Bloc, Sep24State>(
        bloc: _bloc,
        builder: (context, state) {
          final webView = _webViewFor(state);
          return PopScope(
            canPop: false,
            onPopInvokedWithResult: (didPop, result) {
              if (didPop) {
                return;
              }
              _handleUserClose();
            },
            child: Scaffold(
              appBar: AppBar(
                title: Text(
                  state is Sep24WebViewOpen ? widget.title : state.titleText,
                ),
                automaticallyImplyLeading: false,
                leading: IconButton(
                  icon: const Icon(Icons.close_rounded),
                  tooltip: 'Close',
                  onPressed: _handleUserClose,
                ),
                actions: <Widget>[
                  if (state is Sep24WebViewOpen && state.transactionId != null)
                    IconButton(
                      icon: const Icon(Icons.refresh_rounded),
                      tooltip: 'Check status',
                      onPressed: state.isVerifyingStatus
                          ? null
                          : _bloc.refreshStatus,
                    ),
                ],
                bottom: state.isBusy
                    ? const PreferredSize(
                        preferredSize: Size.fromHeight(3),
                        child: LinearProgressIndicator(minHeight: 3),
                      )
                    : null,
              ),
              body: Column(
                children: <Widget>[
                  _Sep24StatusBanner(state: state),
                  Expanded(
                    child: Stack(
                      children: <Widget>[
                        if (webView != null)
                          Positioned.fill(child: webView)
                        else if (state is Sep24Error)
                          _Sep24FailureView(
                            state: state,
                            onRetry: state.recoverable ? _bloc.retry : null,
                          )
                        else
                          _Sep24WaitingView(state: state),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

extension on Sep24State {
  String get titleText {
    switch (this) {
      case Sep24Loading():
        return 'Starting deposit';
      case Sep24Success():
        return 'Deposit complete';
      case Sep24Error():
        return 'Deposit failed';
      case Sep24WebViewOpen():
      case Sep24Initial():
        return 'Deposit';
    }
  }
}

/// Compact live status strip above the anchor page, showing the latest
/// SEP-24 transaction status while the flow runs.
class _Sep24StatusBanner extends StatelessWidget {
  const _Sep24StatusBanner({required this.state});

  final Sep24State state;

  @override
  Widget build(BuildContext context) {
    final content = switch (state) {
      Sep24WebViewOpen(:final status, :final statusMessage) => (
        message: statusMessage ?? status.label,
        icon: status.isTerminalSuccess
            ? Icons.check_circle_outline_rounded
            : Icons.info_outline_rounded,
        tone: _Sep24BannerTone.info,
      ),
      Sep24Error(:final message) => (
        message: message,
        icon: Icons.error_outline_rounded,
        tone: _Sep24BannerTone.error,
      ),
      Sep24Success(:final message) => (
        message: message ?? 'Deposit completed.',
        icon: Icons.check_circle_outline_rounded,
        tone: _Sep24BannerTone.success,
      ),
      _ => null,
    };
    if (content == null) {
      return const SizedBox.shrink();
    }

    final scheme = Theme.of(context).colorScheme;
    final (background, foreground) = switch (content.tone) {
      _Sep24BannerTone.error => (
        scheme.errorContainer,
        scheme.onErrorContainer,
      ),
      _Sep24BannerTone.success => (
        scheme.primaryContainer,
        scheme.onPrimaryContainer,
      ),
      _Sep24BannerTone.info => (
        scheme.surfaceContainerHighest,
        scheme.onSurfaceVariant,
      ),
    };

    return AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      color: background,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Row(
        children: <Widget>[
          Icon(content.icon, size: 18, color: foreground),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              content.message,
              style: Theme.of(
                context,
              ).textTheme.bodySmall?.copyWith(color: foreground),
            ),
          ),
        ],
      ),
    );
  }
}

enum _Sep24BannerTone { info, success, error }

/// Loading/waiting placeholder shown while there is no page to render yet.
class _Sep24WaitingView extends StatelessWidget {
  const _Sep24WaitingView({required this.state});

  final Sep24State state;

  @override
  Widget build(BuildContext context) {
    final message = switch (state) {
      Sep24Loading(:final message) =>
        message ?? 'Contacting the deposit provider…',
      Sep24Success(:final message) => message ?? 'Deposit completed.',
      Sep24Error(:final message) => message,
      _ => 'Waiting for the deposit provider…',
    };
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const SizedBox(height: 8),
            const CircularProgressIndicator(),
            const SizedBox(height: 16),
            Text(
              message,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
        ),
      ),
    );
  }
}

/// Error panel with a retry affordance.
class _Sep24FailureView extends StatelessWidget {
  const _Sep24FailureView({required this.state, this.onRetry});

  final Sep24Error state;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(
              Icons.error_outline_rounded,
              size: 40,
              color: Theme.of(context).colorScheme.error,
            ),
            const SizedBox(height: 16),
            Text(
              state.message,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            if (state.transactionId != null) ...<Widget>[
              const SizedBox(height: 8),
              Text(
                'Reference: ${state.transactionId}',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
            const SizedBox(height: 24),
            if (onRetry != null)
              FilledButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Try again'),
              ),
          ],
        ),
      ),
    );
  }
}

/// The default [Sep24WebViewFactory], backed by `package:webview_flutter`.
Widget defaultSep24WebViewFactory(
  BuildContext context,
  Sep24WebViewRequest request,
) {
  return _Sep24AnchorWebView(request: request);
}

class _Sep24AnchorWebView extends StatefulWidget {
  const _Sep24AnchorWebView({required this.request});

  final Sep24WebViewRequest request;

  @override
  State<_Sep24AnchorWebView> createState() => _Sep24AnchorWebViewState();
}

class _Sep24AnchorWebViewState extends State<_Sep24AnchorWebView> {
  late final WebViewController _controller;
  double _progress = 0;
  bool _loading = true;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFFFFFFFF))
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (navigation) async {
            final consumed = await widget.request.onNavigation(
              navigation.url,
              Sep24NavigationPhase.willLoad,
            );
            return consumed
                ? NavigationDecision.prevent
                : NavigationDecision.navigate;
          },
          onPageStarted: (url) {
            if (!mounted) {
              return;
            }
            setState(() {
              _loading = true;
              _loadError = null;
            });
            widget.request.onNavigation(url, Sep24NavigationPhase.started);
          },
          onPageFinished: (url) async {
            final consumed = await widget.request.onNavigation(
              url,
              Sep24NavigationPhase.finished,
            );
            if (!mounted) {
              return;
            }
            setState(() {
              _loading = false;
              _progress = consumed ? _progress : 1;
            });
          },
          onProgress: (progress) {
            if (!mounted) {
              return;
            }
            setState(() => _progress = progress / 100.0);
          },
          onWebResourceError: (error) {
            if (!mounted || (error.isForMainFrame ?? true) == false) {
              return;
            }
            setState(() {
              _loading = false;
              _loadError = error.description;
            });
          },
        ),
      );
    unawaited(_controller.loadRequest(widget.request.url));
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: <Widget>[
        if (_loading && widget.request.showProgressBar)
          LinearProgressIndicator(
            minHeight: 2,
            value: _progress == 0 ? null : _progress,
          ),
        if (_loadError != null)
          MaterialBanner(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            leading: Icon(
              Icons.wifi_off_rounded,
              color: Theme.of(context).colorScheme.error,
            ),
            content: Text(_loadError!),
            actions: <Widget>[
              TextButton(
                onPressed: () => unawaited(_controller.reload()),
                child: const Text('Reload'),
              ),
            ],
          ),
        Expanded(child: WebViewWidget(controller: _controller)),
      ],
    );
  }
}