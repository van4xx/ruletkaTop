/// Mirrors `packages/shared-types/src/economy.ts`.
library;

import 'enums.dart';

/// `walletSchema` — `{ userId, balanceCoins }`.
class Wallet {
  const Wallet({required this.userId, required this.balanceCoins});

  final String userId;
  final int balanceCoins;

  factory Wallet.fromJson(Map<String, dynamic> json) => Wallet(
        userId: json['userId'] as String? ?? '',
        balanceCoins: (json['balanceCoins'] as num?)?.toInt() ?? 0,
      );
}

/// `coinTransactionSchema` — a single ledger entry.
class CoinTransaction {
  const CoinTransaction({
    required this.id,
    required this.userId,
    required this.delta,
    required this.type,
    required this.refId,
    required this.balanceAfter,
    required this.createdAt,
  });

  final String id;
  final String userId;
  final int delta;
  final CoinTxType type;
  final String? refId;
  final int balanceAfter;
  final DateTime createdAt;

  factory CoinTransaction.fromJson(Map<String, dynamic> json) => CoinTransaction(
        id: json['id'] as String,
        userId: json['userId'] as String? ?? '',
        delta: (json['delta'] as num?)?.toInt() ?? 0,
        type: CoinTxType.fromWire(json['type'] as String?),
        refId: json['refId'] as String?,
        balanceAfter: (json['balanceAfter'] as num?)?.toInt() ?? 0,
        createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
      );
}

/// `coinPackageSchema` — a purchasable coin bundle.
class CoinPackage {
  const CoinPackage({
    required this.code,
    required this.coins,
    required this.priceRub,
    required this.bonusCoins,
  });

  final String code;
  final int coins;
  final int priceRub;
  final int bonusCoins;

  /// Total coins credited (base + bonus) — convenience for UI.
  int get totalCoins => coins + bonusCoins;

  factory CoinPackage.fromJson(Map<String, dynamic> json) => CoinPackage(
        code: json['code'] as String,
        coins: (json['coins'] as num?)?.toInt() ?? 0,
        priceRub: (json['priceRub'] as num?)?.toInt() ?? 0,
        bonusCoins: (json['bonusCoins'] as num?)?.toInt() ?? 0,
      );
}

/// `giftSchema` — a catalog gift.
class Gift {
  const Gift({
    required this.id,
    required this.code,
    required this.title,
    required this.animationUrl,
    required this.priceCoins,
    required this.rarity,
    required this.isPremiumOnly,
  });

  final String id;
  final String code;
  final String title;
  final String animationUrl;
  final int priceCoins;
  final Rarity rarity;
  final bool isPremiumOnly;

  factory Gift.fromJson(Map<String, dynamic> json) => Gift(
        id: json['id'] as String,
        code: json['code'] as String? ?? '',
        title: json['title'] as String? ?? '',
        animationUrl: json['animationUrl'] as String? ?? '',
        priceCoins: (json['priceCoins'] as num?)?.toInt() ?? 0,
        rarity: Rarity.fromWire(json['rarity'] as String?),
        isPremiumOnly: json['isPremiumOnly'] as bool? ?? false,
      );
}

/// `giftTransactionSchema` — a sent-gift record.
class GiftTransaction {
  const GiftTransaction({
    required this.id,
    required this.fromUserId,
    required this.toUserId,
    required this.giftId,
    required this.priceCoins,
    required this.context,
    required this.createdAt,
  });

  final String id;
  final String fromUserId;
  final String toUserId;
  final String giftId;
  final int priceCoins;
  final GiftContext context;
  final DateTime createdAt;

  factory GiftTransaction.fromJson(Map<String, dynamic> json) => GiftTransaction(
        id: json['id'] as String,
        fromUserId: json['fromUserId'] as String? ?? '',
        toUserId: json['toUserId'] as String? ?? '',
        giftId: json['giftId'] as String? ?? '',
        priceCoins: (json['priceCoins'] as num?)?.toInt() ?? 0,
        context: GiftContext.fromWire(json['context'] as String?),
        createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
      );
}

/// `sendGiftSchema` — POST /gifts/send body.
class SendGiftDto {
  const SendGiftDto({
    required this.giftId,
    required this.toUserId,
    required this.context,
    this.message,
  });

  final String giftId;
  final String toUserId;
  final GiftContext context;
  final String? message;

  Map<String, dynamic> toJson() => {
        'giftId': giftId,
        'toUserId': toUserId,
        'context': context.wire,
        if (message != null) 'message': message,
      };
}

/// `topPlacementSchema` — a paid placement in the Top feed.
class TopPlacement {
  const TopPlacement({
    required this.id,
    required this.userId,
    required this.lane,
    required this.priority,
    required this.coinsSpent,
    required this.startsAt,
    required this.expiresAt,
  });

  final String id;
  final String userId;
  final TopLane lane;
  final int priority;
  final int coinsSpent;
  final DateTime startsAt;
  final DateTime expiresAt;

  factory TopPlacement.fromJson(Map<String, dynamic> json) => TopPlacement(
        id: json['id'] as String,
        userId: json['userId'] as String? ?? '',
        lane: TopLane.fromWire(json['lane'] as String?),
        priority: (json['priority'] as num?)?.toInt() ?? 0,
        coinsSpent: (json['coinsSpent'] as num?)?.toInt() ?? 0,
        startsAt: DateTime.tryParse(json['startsAt'] as String? ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
        expiresAt: DateTime.tryParse(json['expiresAt'] as String? ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
      );
}

/// `topPurchaseSchema` — POST /top/purchase body.
class TopPurchaseDto {
  const TopPurchaseDto({
    required this.lane,
    required this.durationHours,
    required this.coins,
  });

  final TopLane lane;
  final int durationHours;
  final int coins;

  Map<String, dynamic> toJson() => {
        'lane': lane.wire,
        'durationHours': durationHours,
        'coins': coins,
      };
}

/// `premiumPlanSchema` — a subscription tier.
class PremiumPlan {
  const PremiumPlan({
    required this.code,
    required this.title,
    required this.priceRub,
    required this.intervalDays,
    required this.perks,
  });

  final String code;
  final String title;
  final int priceRub;
  final int intervalDays;
  final List<String> perks;

  factory PremiumPlan.fromJson(Map<String, dynamic> json) => PremiumPlan(
        code: json['code'] as String,
        title: json['title'] as String? ?? '',
        priceRub: (json['priceRub'] as num?)?.toInt() ?? 0,
        intervalDays: (json['intervalDays'] as num?)?.toInt() ?? 30,
        perks: ((json['perks'] as List?) ?? const [])
            .map((e) => e as String)
            .toList(growable: false),
      );
}

/// `subscriptionSchema` — the caller's premium subscription state.
class Subscription {
  const Subscription({
    required this.id,
    required this.userId,
    required this.plan,
    required this.status,
    required this.startedAt,
    required this.currentPeriodEnd,
    required this.cancelAtPeriodEnd,
  });

  final String id;
  final String userId;
  final String plan;
  final SubscriptionStatus status;
  final DateTime? startedAt;
  final DateTime? currentPeriodEnd;
  final bool cancelAtPeriodEnd;

  factory Subscription.fromJson(Map<String, dynamic> json) => Subscription(
        id: json['id'] as String,
        userId: json['userId'] as String? ?? '',
        plan: json['plan'] as String? ?? '',
        status: SubscriptionStatus.fromWire(json['status'] as String?),
        startedAt: json['startedAt'] != null
            ? DateTime.tryParse(json['startedAt'] as String)
            : null,
        currentPeriodEnd: json['currentPeriodEnd'] != null
            ? DateTime.tryParse(json['currentPeriodEnd'] as String)
            : null,
        cancelAtPeriodEnd: json['cancelAtPeriodEnd'] as bool? ?? false,
      );
}
