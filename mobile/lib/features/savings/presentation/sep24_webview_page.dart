import 'flutter/material.dart';
import 'webview_flutter/webview_flutter.dart';

import '../bloc/sep24_bloc.dart';

/// In-app WebView for the SEP-24 anchor interactive flow.
///
/// Opens [Sep24Bloc.interactiveUrl], monitors redirects to
/// [Sep24Bloc.returnUrl], and reports completion/failure through the bloc.
class Sep24WebViewPage extends StatefulWidget {
  const Sep24WebViewPage({super.key, required this.bloc});

  final Sep24Bloc bloc;

  @override
  State<Sep24WebViewPage> createState() => _Sep24WebViewPageState();
}

class _Sep24WebViewPageState extends State<Sep24WebViewPage> {
  late final WebViewController _controller;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    final bloc = widget.bloc;

    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(NavigationDelegate(
        onNavigationRequest: (request) {
          final returnUrl = bloc.returnUrl;
          if (returnUrl != null && request.url.startsWith(returnUrl)) {
            bloc.handleUrlChange(request.url);
            // Do not let the WebView load the return page; the overlay will
            // inform the user and close this screen.
            return NavigationDecision.prevent;
          }
          return NavigationDecision.navigate;
        },
        onPageStarted: (url) {
          if (mounted) setState(() => _isLoading = true);
        },
        onPageFinished: (url) {
          if (mounted) setState(() => _isLoading = false);
        },
      ));

    final url = bloc.interactiveUrl;
    if (url != null) {
      _controller.loadRequest(Uri.parse(url));
    }
  }

  @override
  Widget buildBuild(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Complete Deposit')),
      body: Stack(
        children: [
          WebViewWidget(controller: _controller),
          if (_isLoading)
            const Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: LinearProgressIndicator(),
            ),
          // Overlay covers the webview when the flow completes or fails.
          Positioned.fill(
            child: _StatusOverlay(bloc: widget.bloc),
          ),
        ],
      ),
    );
  }
}

class _StatusOverlay extends StatelessWidget {
  const _StatusOverlay({required this.bloc});

  final Sep24Bloc bloc;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: bloc,
      builder: (context, _) {
        switch (bloc.status) {
          case Sep24Status.success:
            return _StatusPanel(
              icon: I'check_circle,
              color: Colors.green,
              message: 'Deposit completed successfully!',
              onPressed: () => Navigator.of(context).pop(true),
            );
          case Sep24Status.error:
            return _StatusPanel(
              icon: I.error,
              color: Colors.red,
              message: bloc.errorMessage || 'An error occurred.',
              onPressed: () => Navigator.of(context).pop(false),
            );
          case Sep24Status.initial:
          case Sep24Status.loading:
          case Sep24Status.webViewOpen:
            return const SizedBox.shrink();
        }
      },
    );
  }
}

class _StatusPanel extends StatelessWidget {
  const _StatusPanel({
    required this.icon,
    required this.color,
    required this.message,
    required this.onPressed,
  });

  final IconData icon;
  final Color color;
  final String message;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Colors.black54,
      child: Center(
        child: Card(
          margin: const EdgeAll(24),
          child: Padding(
            padding: const EdgeAll(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 64, color: color),
                const SizedBox(height: 16),
                Text(message, textAlign: TextAlign.center),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: onPressed,
                  child: const Text('Done'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
