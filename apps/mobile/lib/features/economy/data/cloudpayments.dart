import 'dart:convert';

import '../../../core/models/models.dart';

/// CloudPayments configuration + the bridge HTML that drives the hosted widget
/// inside a [WebView]. Card data NEVER touches our servers: the widget is the
/// official CloudPayments script (loaded from their CDN) which tokenises the
/// card directly with the gateway. We only hand it server-minted params and
/// react to the success / fail / complete callbacks via a JS channel.
///
/// This mirrors `apps/web/src/lib/cloudpayments.ts` (which calls
/// `cp.CloudPayments().pay('charge', options, callbacks)` in the browser).
abstract final class CloudPayments {
  /// Official CloudPayments widget bundle (loaded inside the WebView).
  static const String widgetSrc =
      'https://widget.cloudpayments.ru/bundles/cloudpayments.js';

  /// Name of the JS↔Dart channel the bridge HTML posts results on.
  static const String channel = 'CloudPaymentsBridge';

  /// Public id for premium (recurrent) charges. Coins get their public id from
  /// the server (`CheckoutWidgetParams.publicId`); premium has no server
  /// checkout endpoint (see [PremiumCheckout]), so the client supplies it.
  /// Override at build time:
  /// `--dart-define=CLOUDPAYMENTS_PUBLIC_ID=pk_xxx`.
  static const String publicId =
      String.fromEnvironment('CLOUDPAYMENTS_PUBLIC_ID');

  static bool get hasPublicId => publicId.isNotEmpty;
}

/// Messages the bridge HTML posts back through the JS channel. The widget's
/// lifecycle (charge captured / declined / dismissed) maps onto these.
enum CloudPaymentsEvent { success, fail, complete, close }

/// A parsed bridge message (`{ type, reason? }`).
class CloudPaymentsMessage {
  const CloudPaymentsMessage(this.event, {this.reason});

  final CloudPaymentsEvent event;
  final String? reason;

  /// Decode a JSON payload posted by the bridge HTML. Falls back to
  /// [CloudPaymentsEvent.complete] for anything unrecognized so the flow never
  /// hangs on a malformed message.
  factory CloudPaymentsMessage.parse(String raw) {
    try {
      final json = jsonDecode(raw) as Map<String, dynamic>;
      final type = json['type'] as String?;
      final event = switch (type) {
        'success' => CloudPaymentsEvent.success,
        'fail' => CloudPaymentsEvent.fail,
        'close' => CloudPaymentsEvent.close,
        _ => CloudPaymentsEvent.complete,
      };
      return CloudPaymentsMessage(event, reason: json['reason'] as String?);
    } catch (_) {
      return const CloudPaymentsMessage(CloudPaymentsEvent.complete);
    }
  }
}

/// The full set of params handed to the CloudPayments `charge` call. For coins
/// these come straight from the server ([CheckoutWidgetParams]); for premium
/// they are assembled client-side with a [recurrent] descriptor.
class CloudPaymentsCharge {
  const CloudPaymentsCharge({
    required this.publicId,
    required this.description,
    required this.amount,
    required this.currency,
    required this.accountId,
    required this.invoiceId,
    required this.data,
  });

  final String publicId;
  final String description;
  final num amount;
  final String currency;
  final String accountId;
  final String invoiceId;

  /// Arbitrary JSON echoed back to our webhooks via the `Data` field. For
  /// premium this carries `cloudPayments.recurrent` (the subscription cadence).
  final Map<String, dynamic> data;

  /// Build the charge for a server-minted coin checkout.
  factory CloudPaymentsCharge.coins(CheckoutWidgetParams params) =>
      CloudPaymentsCharge(
        publicId: params.publicId,
        description: params.description,
        amount: params.amount,
        currency: params.currency,
        accountId: params.accountId,
        invoiceId: params.invoiceId,
        data: params.data,
      );

  /// Build a recurrent charge for a premium plan (mirrors the web's
  /// `planToRecurrent` + `data` tagging).
  factory CloudPaymentsCharge.premium({
    required String publicId,
    required PremiumPlan plan,
    required String userId,
  }) {
    return CloudPaymentsCharge(
      publicId: publicId,
      description: 'Премиум · ${plan.title}',
      amount: plan.priceRub,
      currency: 'RUB',
      accountId: userId,
      invoiceId: 'prem_${plan.code}_${DateTime.now().millisecondsSinceEpoch}',
      data: {
        'purpose': 'premium',
        'plan': plan.code,
        'userId': userId,
        'cloudPayments': {'recurrent': _recurrent(plan.intervalDays)},
      },
    );
  }

  /// Map a plan's `intervalDays` to a CloudPayments recurrent descriptor
  /// (`{ interval, period }`), matching the web's `planToRecurrent`.
  static Map<String, dynamic> _recurrent(int intervalDays) {
    if (intervalDays % 30 == 0) {
      return {'interval': 'Month', 'period': (intervalDays ~/ 30).clamp(1, 1 << 31)};
    }
    if (intervalDays % 7 == 0) {
      return {'interval': 'Week', 'period': (intervalDays ~/ 7).clamp(1, 1 << 31)};
    }
    return {'interval': 'Day', 'period': intervalDays.clamp(1, 1 << 31)};
  }

  Map<String, dynamic> _options() => {
        'publicId': publicId,
        'description': description,
        'amount': amount,
        'currency': currency,
        'accountId': accountId,
        'invoiceId': invoiceId,
        'data': data,
      };

  /// The self-contained HTML page loaded into the WebView. It loads the widget
  /// bundle, opens the `charge` form, and relays lifecycle events to Dart via
  /// the [CloudPayments.channel] JS channel.
  String buildHtml() {
    final optionsJson = jsonEncode(_options());
    return '''
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  html, body {
    margin: 0; padding: 0; height: 100%;
    background: #0B0C16; color: #F4F5FB;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .center {
    display: flex; align-items: center; justify-content: center;
    height: 100%; flex-direction: column; gap: 16px; text-align: center; padding: 24px;
  }
  .spinner {
    width: 42px; height: 42px; border-radius: 50%;
    border: 3px solid rgba(179,104,255,0.25); border-top-color: #B368FF;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .muted { color: #9D9DAB; font-size: 14px; }
</style>
</head>
<body>
  <div class="center">
    <div class="spinner"></div>
    <div class="muted">Открываем безопасную оплату…</div>
  </div>
  <script src="${CloudPayments.widgetSrc}"></script>
  <script>
    (function () {
      var sent = false;
      function post(payload) {
        try {
          if (window.${CloudPayments.channel} && window.${CloudPayments.channel}.postMessage) {
            window.${CloudPayments.channel}.postMessage(JSON.stringify(payload));
          }
        } catch (e) {}
      }
      function fail(reason) {
        if (sent) return; sent = true;
        post({ type: 'fail', reason: reason || 'Платёж не прошёл' });
      }
      function ok() {
        if (sent) return; sent = true;
        post({ type: 'success' });
      }
      function start() {
        if (!window.cp || !window.cp.CloudPayments) {
          fail('Не удалось загрузить виджет оплаты');
          return;
        }
        var options = $optionsJson;
        try {
          var widget = new cp.CloudPayments({ language: 'ru-RU' });
          widget.pay('charge', options, {
            onSuccess: function () { ok(); },
            onFail: function (reason) { fail(reason); },
            onComplete: function (res) {
              // Always fired after the gateway responds. If neither success nor
              // fail fired (e.g. user dismissed), report completion.
              if (!sent) {
                if (res && res.success) { ok(); }
                else { post({ type: 'complete' }); }
              }
            }
          });
        } catch (e) {
          fail((e && e.message) ? e.message : 'Ошибка оплаты');
        }
      }
      // Give the bundle a moment to attach `window.cp`.
      if (window.cp && window.cp.CloudPayments) { start(); }
      else { window.addEventListener('load', function () { setTimeout(start, 150); }); }
    })();
  </script>
</body>
</html>
''';
  }
}
