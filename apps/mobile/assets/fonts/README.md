# Bundled typefaces

The app ships its two brand typefaces **in the binary** so type renders on the
first frame with no fallback-font flash/reflow and **no cold-launch network
dependency** (important on poor / restricted connections):

| Family      | File                                | Axis   | Used weights                  |
| ----------- | ----------------------------------- | ------ | ----------------------------- |
| `Unbounded` | `Unbounded-VariableFont_wght.ttf`   | `wght` | w600, w700, w800 (display)    |
| `Manrope`   | `Manrope-VariableFont_wght.ttf`     | `wght` | w400, w600, w700, w800 (body) |

Both are **variable fonts** (a single `wght` axis). Flutter applies the
requested `FontWeight` to the axis, so one file per family covers every weight
the type system uses (see `lib/core/theme/app_typography.dart`).

## How resolution works (do not re-enable runtime fetching)

1. `pubspec.yaml` declares each family under `flutter: fonts:` pointing at the
   `.ttf` here. The family names (`Unbounded`, `Manrope`) match the names the
   `google_fonts` package generates for `GoogleFonts.unbounded()` /
   `GoogleFonts.manrope()`.
2. `main.dart` sets `GoogleFonts.config.allowRuntimeFetching = false` **before**
   `runApp()`. With fetching off, `google_fonts` resolves the family from the
   bundled asset instead of downloading the `.ttf` from `fonts.gstatic.com`.

If you change the weights the UI uses, no font files need to change — the
variable axis already spans the full weight range; just use the new
`FontWeight` in `app_typography.dart`.

## Provenance & license

Fetched from the official Google Fonts source repository (`google/fonts`,
`main` branch):

- Unbounded: `ofl/unbounded/Unbounded[wght].ttf`
- Manrope:   `ofl/manrope/Manrope[wght].ttf`

Both are licensed under the **SIL Open Font License 1.1**. The license text for
each is checked in beside the fonts as `OFL-Unbounded.txt` / `OFL-Manrope.txt`.
The OFL permits bundling/redistribution inside an application.

## Re-provisioning the .ttf (if absent from a checkout)

```sh
cd apps/mobile/assets/fonts
curl -sSL -o Unbounded-VariableFont_wght.ttf \
  "https://github.com/google/fonts/raw/main/ofl/unbounded/Unbounded%5Bwght%5D.ttf"
curl -sSL -o Manrope-VariableFont_wght.ttf \
  "https://github.com/google/fonts/raw/main/ofl/manrope/Manrope%5Bwght%5D.ttf"
```
