import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../profile_providers.dart';
import 'cover_art.dart';

/// Opens the cover-picker sheet — a grid of cover thumbnails the user can apply
/// (owned/free) or buy (paid, debits coins). Mirrors the web `CoverPickerModal`.
Future<void> showCoverPickerSheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor: context.scheme.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadii.xxl)),
    ),
    builder: (_) => const _CoverPickerSheet(),
  );
}

class _CoverPickerSheet extends ConsumerWidget {
  const _CoverPickerSheet();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final catalogAsync = ref.watch(coverCatalogProvider);
    final inventoryAsync = ref.watch(coverInventoryProvider);
    final action = ref.watch(coverActionProvider);
    final maxHeight = MediaQuery.sizeOf(context).height * 0.85;

    // Surface action success/error as a snackbar.
    ref.listen(coverActionProvider, (prev, next) {
      if (next.message != null && next.message != prev?.message) {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(next.message!)));
      }
    });

    return ConstrainedBox(
      constraints: BoxConstraints(maxHeight: maxHeight),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Обложка профиля', style: context.texts.titleLarge),
                const SizedBox(height: 2),
                Text(
                  'Выберите оформление шапки профиля.',
                  style: context.texts.bodySmall
                      ?.copyWith(color: context.scheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
          Flexible(
            child: catalogAsync.when(
              loading: () => const Padding(
                padding: EdgeInsets.all(AppSpacing.xxl),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (_, _) => Padding(
                padding: const EdgeInsets.all(AppSpacing.xxl),
                child: ErrorView(
                  title: 'Не удалось загрузить обложки',
                  message: 'Проверьте соединение и попробуйте снова.',
                  onRetry: () => ref.invalidate(coverCatalogProvider),
                ),
              ),
              data: (catalogue) {
                final inventory = inventoryAsync.value;
                return GridView.builder(
                  padding: const EdgeInsets.fromLTRB(
                      AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.xxl),
                  gridDelegate:
                      const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 2,
                    mainAxisSpacing: AppSpacing.md,
                    crossAxisSpacing: AppSpacing.md,
                    childAspectRatio: 1.45,
                  ),
                  itemCount: catalogue.length,
                  itemBuilder: (context, i) {
                    final cover = catalogue[i];
                    final owned =
                        cover.isFree || (inventory?.owns(cover.id) ?? false);
                    final active = inventory?.active == cover.id;
                    return _CoverTile(
                      cover: cover,
                      owned: owned,
                      active: active,
                      busy: action.isBusy,
                      onTap: () => _onTap(ref, cover, owned, active),
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  void _onTap(WidgetRef ref, ProfileCover cover, bool owned, bool active) {
    if (active) return;
    final notifier = ref.read(coverActionProvider.notifier);
    if (owned) {
      notifier.activate(cover.id);
    } else {
      notifier.purchase(cover.id);
    }
  }
}

class _CoverTile extends StatelessWidget {
  const _CoverTile({
    required this.cover,
    required this.owned,
    required this.active,
    required this.busy,
    required this.onTap,
  });

  final ProfileCover cover;
  final bool owned;
  final bool active;
  final bool busy;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: AppRadii.brLg,
        onTap: busy ? null : onTap,
        child: AnimatedContainer(
          duration: AppDurations.fast,
          decoration: BoxDecoration(
            borderRadius: AppRadii.brLg,
            border: Border.all(
              color: active ? colors.neonCyan : colors.glassBorder,
              width: active ? 2 : 1,
            ),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(AppRadii.lg - 1),
            child: Stack(
              fit: StackFit.expand,
              children: [
                CoverArt(coverId: cover.id, thumbnail: true),
                // Bottom label band.
                Align(
                  alignment: Alignment.bottomCenter,
                  child: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.sm, vertical: 6),
                    color: scheme.surface.withValues(alpha: 0.6),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            cover.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: context.texts.labelMedium?.copyWith(
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        _Tag(cover: cover, owned: owned, active: active),
                      ],
                    ),
                  ),
                ),
                if (active)
                  Positioned(
                    top: 6,
                    right: 6,
                    child: Container(
                      padding: const EdgeInsets.all(4),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: colors.neonCyan,
                      ),
                      child: const Icon(Icons.check_rounded,
                          size: 14, color: Colors.black),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The trailing tag in the label band: "Активна" / "Применить" (owned) /
/// the coin price (paid + unowned).
class _Tag extends StatelessWidget {
  const _Tag({required this.cover, required this.owned, required this.active});

  final ProfileCover cover;
  final bool owned;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    if (active) {
      return Text('Активна',
          style: context.texts.labelSmall?.copyWith(color: colors.neonCyan));
    }
    if (owned) {
      return Text('Применить',
          style: context.texts.labelSmall
              ?.copyWith(color: context.scheme.onSurfaceVariant));
    }
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.monetization_on_rounded, size: 13, color: colors.warning),
        const SizedBox(width: 3),
        Text(
          '${cover.priceCoins}',
          style: context.texts.labelSmall?.copyWith(
            color: colors.warning,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }
}
