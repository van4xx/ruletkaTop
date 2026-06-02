import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../../core/theme/theme.dart';
import '../data/cloudpayments.dart';

/// A modal sheet that hosts the CloudPayments hosted widget inside a [WebView].
///
/// Card data never reaches our app: the embedded HTML loads the official
/// CloudPayments bundle and tokenises the card with the gateway directly. The
/// bridge HTML relays `success` / `fail` / `complete` over a JS channel; this
/// sheet pops with a [CloudPaymentsMessage] describing the outcome.
///
/// Returns `null` if the user closes the sheet before the widget resolves.
class CloudPaymentsWebView extends StatefulWidget {
  const CloudPaymentsWebView({super.key, required this.charge});

  final CloudPaymentsCharge charge;

  /// Present as a full-height modal sheet and await the outcome.
  static Future<CloudPaymentsMessage?> show(
    BuildContext context,
    CloudPaymentsCharge charge,
  ) {
    return showModalBottomSheet<CloudPaymentsMessage>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => FractionallySizedBox(
        heightFactor: 0.92,
        child: CloudPaymentsWebView(charge: charge),
      ),
    );
  }

  @override
  State<CloudPaymentsWebView> createState() => _CloudPaymentsWebViewState();
}

class _CloudPaymentsWebViewState extends State<CloudPaymentsWebView> {
  late final WebViewController _controller;
  bool _loading = true;
  bool _resolved = false;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(AppPalette.darkBackground)
      ..addJavaScriptChannel(
        CloudPayments.channel,
        onMessageReceived: _onBridgeMessage,
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (_) {
            if (mounted) setState(() => _loading = false);
          },
          onWebResourceError: (error) {
            // Ignore subresource errors (ads/analytics in the widget); only a
            // hard main-frame failure should abort.
            if (error.isForMainFrame == true) {
              _resolve(const CloudPaymentsMessage(
                CloudPaymentsEvent.fail,
                reason: 'Не удалось загрузить страницу оплаты',
              ));
            }
          },
        ),
      )
      // `baseUrl` is set to the widget origin so the bundle's same-origin
      // assumptions hold inside the WebView.
      ..loadHtmlString(
        widget.charge.buildHtml(),
        baseUrl: 'https://widget.cloudpayments.ru/',
      );
  }

  void _onBridgeMessage(JavaScriptMessage message) {
    final parsed = CloudPaymentsMessage.parse(message.message);
    // `complete` without a prior success/fail means the user dismissed the
    // gateway form — treat it as a soft close (no error banner).
    if (parsed.event == CloudPaymentsEvent.complete) {
      _resolve(const CloudPaymentsMessage(CloudPaymentsEvent.close));
      return;
    }
    _resolve(parsed);
  }

  void _resolve(CloudPaymentsMessage result) {
    if (_resolved || !mounted) return;
    _resolved = true;
    Navigator.of(context).pop(result);
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return ClipRRect(
      borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadii.xxl)),
      child: Scaffold(
        backgroundColor: context.scheme.surface,
        appBar: AppBar(
          automaticallyImplyLeading: false,
          title: const Text('Оплата'),
          leading: IconButton(
            icon: const Icon(Icons.close_rounded),
            tooltip: 'Закрыть',
            onPressed: () =>
                _resolve(const CloudPaymentsMessage(CloudPaymentsEvent.close)),
          ),
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(1),
            child: Container(height: 1, color: colors.glassBorder),
          ),
        ),
        body: Stack(
          children: [
            WebViewWidget(controller: _controller),
            if (_loading)
              ColoredBox(
                color: context.scheme.surface,
                child: const Center(child: CircularProgressIndicator()),
              ),
          ],
        ),
      ),
    );
  }
}
