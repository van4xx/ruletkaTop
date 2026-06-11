/// Build-time configuration for the on-device safety pipeline (NSFW screening).
///
/// All values resolve via [String.fromEnvironment] / [bool.fromEnvironment] /
/// [int.fromEnvironment] so they're frozen at compile time and tree-shake out
/// when disabled. Pass with `--dart-define`, e.g.:
///
/// ```sh
/// flutter build apk --dart-define=NSFW_ENABLED=true
/// ```
///
/// The env switch is a soft gate ON TOP of the asset-presence gate
/// ([NsfwService.tryLoad]): even with `NSFW_ENABLED=true`, when the operator-
/// provisioned `assets/models/nsfw.tflite` is missing the service stays inert
/// and every classify() returns SAFE. Conversely, with `NSFW_ENABLED=false` we
/// skip the model probe + the periodic sampling entirely (no boot-time disk
/// hit, no per-call inference cost) even if the asset is present.
library;

/// Whether the on-device NSFW pipeline is allowed to run at all. Default
/// `false` — operators opt IN explicitly per build (so debug builds + the
/// open-source default don't ship a screening behaviour the maintainer didn't
/// audit). Read once at class-load via [bool.fromEnvironment]; runtime mutation
/// is intentionally NOT supported (changes require a rebuild).
///
/// Env switch name: **`NSFW_ENABLED`** (string, case-insensitive `true`/`false`).
const bool kNsfwEnabled = bool.fromEnvironment(
  'NSFW_ENABLED',
  defaultValue: false,
);

/// Asset path of the on-device NSFW model. Mirrors `kNsfwModelAsset` in
/// `features/roulette/data/nsfw_classifier.dart` — kept in sync at the call
/// site (the scaffolding here defers the load to the existing classifier so
/// there's exactly ONE place that touches the asset bundle).
const String kNsfwModelAssetPath = 'assets/models/nsfw.tflite';

/// How often the safety pipeline samples the local camera during a video call,
/// in **seconds**. Defaults to 3s (matches the existing `_kSampleInterval` in
/// `local_screening.dart`). Operators can stretch this to 5–10s on lower-end
/// hardware via `--dart-define=NSFW_SAMPLE_SECONDS=...`.
const int kNsfwSampleIntervalSeconds = int.fromEnvironment(
  'NSFW_SAMPLE_SECONDS',
  defaultValue: 3,
);

/// Battery-percentage floor below which the safety pipeline THROTTLES
/// inference cycles to conserve power (it skips every sample tick under this).
/// Matches the spec: "throttle when battery is below 15%".
const int kNsfwBatteryThrottlePercent = int.fromEnvironment(
  'NSFW_BATTERY_THROTTLE',
  defaultValue: 15,
);

/// Combined NSFW-class confidence threshold at which the pipeline emits a
/// `client-signal` to the server. The pipeline sums `porn + hentai + sexy`
/// (per the task spec) and trips when the sum exceeds this value.
///
/// `local_screening.dart` continues to own the LOCAL-cut decision (per-label
/// thresholds 0.7 / 0.85, mirroring the web policy). This threshold is the
/// SECONDARY gate that drives the lighter-weight client-signal stream.
const double kNsfwClientSignalThreshold = 0.85;
