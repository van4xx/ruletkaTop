/// Mirrors `packages/shared-types/src/moderation.ts`.
library;

import 'enums.dart';

/// `createReportSchema` — POST /reports body.
class CreateReportDto {
  const CreateReportDto({
    required this.againstUserId,
    this.matchId,
    required this.reason,
    this.details,
  });

  final String againstUserId;
  final String? matchId;
  final ReportReason reason;
  final String? details;

  Map<String, dynamic> toJson() => {
        'againstUserId': againstUserId,
        if (matchId != null) 'matchId': matchId,
        'reason': reason.wire,
        if (details != null) 'details': details,
      };
}

/// `createBlockSchema` — POST /blocks body.
class CreateBlockDto {
  const CreateBlockDto({required this.blockedUserId});

  final String blockedUserId;

  Map<String, dynamic> toJson() => {'blockedUserId': blockedUserId};
}

/// `blockSchema` — a persisted block record.
class Block {
  const Block({
    required this.id,
    required this.userId,
    required this.blockedUserId,
    required this.createdAt,
  });

  final String id;
  final String userId;
  final String blockedUserId;
  final DateTime createdAt;

  factory Block.fromJson(Map<String, dynamic> json) => Block(
        id: json['id'] as String,
        userId: json['userId'] as String? ?? '',
        blockedUserId: json['blockedUserId'] as String? ?? '',
        createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
      );
}
