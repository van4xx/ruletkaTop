# On-device NSFW model (`nsfw.tflite`)

This directory holds the **operator-provisioned** TensorFlow Lite model that the
mobile app's on-device NSFW screening uses. The model **binary is NOT committed
to the repo** — drop it in here as `nsfw.tflite` to enable on-device video
moderation. The app **builds, boots and runs without it** (the classifier
degrades to a no-op; the screening pipeline still samples frames but never flags,
so a clean user is never falsely cut). See
`lib/features/roulette/data/nsfw_classifier.dart`.

## Expected model

- **Architecture:** MobileNetV2, the same network the web client runs via
  [nsfwjs](https://github.com/infinitered/nsfwjs).
- **Source:** [gantman/nsfw_model](https://github.com/GantMan/nsfw_model)
  (`nsfw_mobilenet_v2_140_224`), converted to TensorFlow Lite. nsfwjs ships this
  same model for the web; mobile mirrors it so the two clients agree.
- **Input:** a single `[1, 224, 224, 3]` **float32** tensor, RGB, normalized to
  `[0, 1]` (pixel value / 255). The app decodes the captured JPEG frame, resizes
  to 224×224, and fills this layout — see `TfliteNsfwClassifier.classify`.
- **Output:** a `[1, 5]` **float32** tensor of class probabilities (softmax), in
  this **exact order** (the model's training labels, alphabetical):

  | index | class      | contract label (`ModerationLabel`) |
  | ----- | ---------- | ---------------------------------- |
  | 0     | `Drawings` | safe                               |
  | 1     | `Hentai`   | `sexual`                           |
  | 2     | `Neutral`  | safe                               |
  | 3     | `Porn`     | `sexual`                           |
  | 4     | `Sexy`     | `nudity`                           |

  The class→label mapping is `max(Porn, Hentai) ⇒ sexual`, `Sexy ⇒ nudity`,
  else safe — identical to the web
  (`apps/web/src/features/moderation/classifier.ts`). Thresholds live in
  `lib/features/roulette/data/local_screening.dart` (sexual ≥ 0.7, nudity ≥
  0.85), also matching the web policy.

> If you convert a variant whose output order differs, update `_kClassOrder` in
> `nsfw_classifier.dart` to match, or the labels will be wrong.

## How to provision

1. Obtain `nsfw_mobilenet_v2_140_224` from gantman/nsfw_model (or convert the
   nsfwjs SavedModel/Keras model to `.tflite` with the TFLite converter at
   224×224 float32 input).
2. Place the file here as `apps/mobile/assets/models/nsfw.tflite`.
3. Rebuild. On boot the app probes the asset; when present and loadable it logs
   `[nsfw] on-device TFLite classifier active` and screening goes live.

## Hash-check protocol

Pin the SHA-256 of the binary you ship to operators (so a corrupted /
backdoored binary on a build server doesn't silently activate screening):

```sh
shasum -a 256 apps/mobile/assets/models/nsfw.tflite
# expected (gantman/nsfw_model 224×224 fp32 conversion — recompute for your build):
# 0000000000000000000000000000000000000000000000000000000000000000  nsfw.tflite
```

CI publishes the hash to ops; a mismatch at boot is logged (see
`lib/core/safety/nsfw_service.dart`) and the service stays inert.

## Env switch

The scaffold loader in `lib/core/safety/nsfw_service.dart` is additionally
gated behind a **build-time** env flag:

```sh
flutter build apk --dart-define=NSFW_ENABLED=true
```

With `NSFW_ENABLED=false` (the default), the service skips the asset probe
entirely and every classify() returns SAFE — so even a build that ships the
binary stays inert until an operator flips the switch.

## License

The gantman/nsfw_model weights are released under the **MIT License**
(© Gant Laborde / Infinite Red). Keep the upstream license notice with any
redistribution of the binary. This README and the integration code are part of
this repository and follow its license.
