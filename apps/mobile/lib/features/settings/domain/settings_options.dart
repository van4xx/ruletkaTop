/// Russian-labelled option lists for the settings selects, typed against the
/// shared Dart enums so they can't drift from the contract. Ports the web's
/// `VISIBILITY_OPTIONS` (`apps/web/src/features/settings/options.ts`).
library;

import '../../../core/models/models.dart';
import '../../auth/domain/auth_options.dart' show Choice;

/// Visibility choices for the privacy selects (who can message / call / view).
const List<Choice<Visibility>> kVisibilityChoices = [
  Choice(Visibility.everyone, 'Все'),
  Choice(Visibility.friends, 'Только друзья'),
  Choice(Visibility.nobody, 'Никто'),
];

/// Theme choices for the appearance section.
const List<Choice<AppThemeMode>> kThemeChoices = [
  Choice(AppThemeMode.light, 'Светлая'),
  Choice(AppThemeMode.dark, 'Тёмная'),
  Choice(AppThemeMode.system, 'Системная'),
];
