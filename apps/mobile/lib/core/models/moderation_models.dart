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

// ── Real-time AI moderation (live-video frame screening) ───────────────────
// Mirrors `packages/shared-types/src/moderation.ts`. An on-device classifier
// samples the LOCAL video; on a likely violation the client (1) instantly
// blurs/cuts locally and (2) reports it via [ModerationViolationDto] with a
// downscaled evidence frame. The server records it, applies an escalation
// policy (warn → kick → ban), and may force an action via `mod:action`
// ([ModerationActionPayload]).

/// `moderationViolationSchema` — client→server: a violation detected by
/// on-device screening, carried to `POST /moderation/frame` with evidence.
class ModerationViolationDto {
  const ModerationViolationDto({
    this.matchId,
    required this.label,
    required this.score,
    this.evidence,
  });

  final String? matchId;
  final ModerationLabel label;

  /// Classifier confidence in [0,1].
  final double score;

  /// Downscaled JPEG data-URL evidence frame, retained for human review.
  final String? evidence;

  Map<String, dynamic> toJson() => {
        if (matchId != null) 'matchId': matchId,
        'label': label.wire,
        'score': score,
        if (evidence != null) 'evidence': evidence,
      };
}

/// `moderationActionPayloadSchema` — server→client: a forced moderation action
/// on the current session, delivered over the `mod:action` event on `/mm`.
class ModerationActionPayload {
  const ModerationActionPayload({
    required this.action,
    this.label,
    this.reason,
    this.banExpiresAt,
  });

  final ModerationAction action;
  final ModerationLabel? label;
  final String? reason;

  /// Unix epoch (seconds) the ban lifts, when [action] is `ban` and temporary.
  final int? banExpiresAt;

  factory ModerationActionPayload.fromJson(Map<String, dynamic> json) =>
      ModerationActionPayload(
        action: ModerationAction.fromWire(json['action'] as String?),
        label: json['label'] != null
            ? ModerationLabel.fromWire(json['label'] as String?)
            : null,
        reason: json['reason'] as String?,
        banExpiresAt: (json['banExpiresAt'] as num?)?.toInt(),
      );
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
