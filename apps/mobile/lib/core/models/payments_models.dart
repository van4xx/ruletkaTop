/// Mirrors `packages/shared-types/src/payments.ts` (client-facing subset).
library;

/// `coinsCheckoutSchema` — POST /payments/coins/checkout body.
class CoinsCheckoutDto {
  const CoinsCheckoutDto({required this.packageCode});

  final String packageCode;

  Map<String, dynamic> toJson() => {'packageCode': packageCode};
}

/// `checkoutWidgetParamsSchema` — params the API returns to open the
/// CloudPayments widget (the mobile fallback opens this in a WebView).
class CheckoutWidgetParams {
  const CheckoutWidgetParams({
    required this.publicId,
    required this.invoiceId,
    required this.amount,
    required this.currency,
    required this.accountId,
    required this.description,
    required this.data,
  });

  final String publicId;
  final String invoiceId;
  final num amount;
  final String currency;
  final String accountId;
  final String description;

  /// Arbitrary JSON echoed back to the server in webhooks.
  final Map<String, dynamic> data;

  factory CheckoutWidgetParams.fromJson(Map<String, dynamic> json) => CheckoutWidgetParams(
        publicId: json['publicId'] as String? ?? '',
        invoiceId: json['invoiceId'] as String? ?? '',
        amount: (json['amount'] as num?) ?? 0,
        currency: json['currency'] as String? ?? 'RUB',
        accountId: json['accountId'] as String? ?? '',
        description: json['description'] as String? ?? '',
        data: (json['data'] as Map<String, dynamic>?) ?? const {},
      );
}
