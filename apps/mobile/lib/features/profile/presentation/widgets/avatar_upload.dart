import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../../core/theme/theme.dart';
import '../profile_providers.dart';

/// The "Сменить аватар" action row on the own-profile screen. Tapping it opens
/// a sheet to pick from the gallery or take a photo, then uploads the bytes via
/// `POST /profiles/me/avatar` (the server re-encodes + stores them). If an
/// avatar already exists, a "remove" option resets it (`DELETE`).
class AvatarActionRow extends ConsumerWidget {
  const AvatarActionRow({super.key, required this.hasAvatar});

  final bool hasAvatar;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = context.colors;
    final busy = ref.watch(avatarActionProvider).isBusy;

    // Surface upload/reset success + error as a snackbar.
    ref.listen(avatarActionProvider, (prev, next) {
      if (next.message != null && next.message != prev?.message) {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(next.message!)));
      }
    });

    return InkWell(
      onTap: busy ? null : () => _openSheet(context, ref),
      borderRadius: AppRadii.brMd,
      child: Padding(
        padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.sm, vertical: AppSpacing.md),
        child: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                borderRadius: AppRadii.brMd,
                color: colors.neonViolet.withValues(alpha: 0.14),
              ),
              child: busy
                  ? const Padding(
                      padding: EdgeInsets.all(9),
                      child: CircularProgressIndicator(strokeWidth: 2.2),
                    )
                  : Icon(Icons.add_a_photo_outlined,
                      size: 19, color: colors.neonViolet),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Сменить аватар', style: context.texts.titleSmall),
                  const SizedBox(height: 1),
                  Text(
                    'Загрузите фото из галереи или с камеры',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: context.texts.bodySmall
                        ?.copyWith(color: context.scheme.onSurfaceVariant),
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right_rounded,
                color: context.scheme.onSurfaceVariant),
          ],
        ),
      ),
    );
  }

  Future<void> _openSheet(BuildContext context, WidgetRef ref) async {
    final source = await showModalBottomSheet<_AvatarChoice>(
      context: context,
      showDragHandle: true,
      backgroundColor: context.scheme.surface,
      builder: (_) => _AvatarSourceSheet(canRemove: hasAvatar),
    );
    if (source == null || !context.mounted) return;

    if (source == _AvatarChoice.remove) {
      await ref.read(avatarActionProvider.notifier).remove();
      return;
    }

    final picker = ImagePicker();
    final XFile? file = await picker.pickImage(
      source: source == _AvatarChoice.camera
          ? ImageSource.camera
          : ImageSource.gallery,
      // Cap the upload size — the server re-encodes to a square WEBP anyway, so
      // shipping a smaller source saves bandwidth.
      maxWidth: 1024,
      maxHeight: 1024,
      imageQuality: 90,
    );
    if (file == null) return;

    final bytes = await file.readAsBytes();
    await ref.read(avatarActionProvider.notifier).upload(
          bytes,
          filename: _safeName(file.name),
          mimeType: file.mimeType ?? _mimeFromName(file.name),
        );
  }

  /// A safe, extension-bearing filename for the multipart part (image_picker's
  /// name can be empty on some platforms).
  static String _safeName(String name) {
    final trimmed = name.trim();
    if (trimmed.isNotEmpty && _ext(trimmed).isNotEmpty) return trimmed;
    return 'avatar.jpg';
  }

  /// Best-effort content-type from the file extension.
  static String? _mimeFromName(String name) {
    final ext = _ext(name).toLowerCase();
    return switch (ext) {
      '.png' => 'image/png',
      '.webp' => 'image/webp',
      '.gif' => 'image/gif',
      '.heic' || '.heif' => 'image/heic',
      '.jpg' || '.jpeg' || '' => 'image/jpeg',
      _ => null,
    };
  }

  /// The file extension (including the dot), or '' if none — a tiny inline
  /// helper so we don't pull in the `path` package for one call.
  static String _ext(String name) {
    final dot = name.lastIndexOf('.');
    final slash = name.lastIndexOf('/');
    if (dot <= slash || dot == name.length - 1) return '';
    return name.substring(dot);
  }
}

/// What the user picked in the source sheet.
enum _AvatarChoice { gallery, camera, remove }

class _AvatarSourceSheet extends StatelessWidget {
  const _AvatarSourceSheet({required this.canRemove});

  final bool canRemove;

  @override
  Widget build(BuildContext context) {
    final scheme = context.scheme;
    return SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            leading: const Icon(Icons.photo_library_outlined),
            title: const Text('Выбрать из галереи'),
            onTap: () => Navigator.of(context).pop(_AvatarChoice.gallery),
          ),
          ListTile(
            leading: const Icon(Icons.photo_camera_outlined),
            title: const Text('Сделать фото'),
            onTap: () => Navigator.of(context).pop(_AvatarChoice.camera),
          ),
          if (canRemove)
            ListTile(
              leading: Icon(Icons.delete_outline_rounded, color: scheme.error),
              title: Text('Удалить аватар',
                  style: TextStyle(color: scheme.error)),
              onTap: () => Navigator.of(context).pop(_AvatarChoice.remove),
            ),
          const SizedBox(height: AppSpacing.sm),
        ],
      ),
    );
  }
}
