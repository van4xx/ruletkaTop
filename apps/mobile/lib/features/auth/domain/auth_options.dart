/// Russian-labelled option lists + the country catalog for the auth/profile
/// forms, typed against the shared Dart enums so they can't drift from the
/// contract. Ports the web's `GENDER_OPTIONS`/`LOCALE_OPTIONS`
/// (`apps/web/src/features/auth/schemas.ts`) and `COUNTRIES`
/// (`packages/ui/src/lib/countries.ts`).
library;

import '../../../core/models/models.dart';

/// A selectable option with a wire [value] and a human [label].
class Choice<T> {
  const Choice(this.value, this.label);
  final T value;
  final String label;
}

/// Gender choices for the register segmented control (Russian labels).
const List<Choice<Gender>> kGenderChoices = [
  Choice(Gender.female, 'Женский'),
  Choice(Gender.male, 'Мужской'),
  Choice(Gender.other, 'Другое'),
];

/// Interface-language choices (register + appearance settings).
const List<Choice<Locale>> kLocaleChoices = [
  Choice(Locale.ru, 'Русский'),
  Choice(Locale.en, 'English'),
];

/// A country in the picker. The flag is derived from [code] at render time via
/// [CountryFlag], so we only store `{ code, name }`.
class CountryOption {
  const CountryOption(this.code, this.name);

  /// ISO 3166-1 alpha-2, uppercase.
  final String code;

  /// English display name (matches the web catalog).
  final String name;
}

/// A broad, production-ready country list (1:1 with the web's `COUNTRIES`).
const List<CountryOption> kCountries = [
  CountryOption('RU', 'Russia'),
  CountryOption('US', 'United States'),
  CountryOption('GB', 'United Kingdom'),
  CountryOption('UA', 'Ukraine'),
  CountryOption('DE', 'Germany'),
  CountryOption('FR', 'France'),
  CountryOption('ES', 'Spain'),
  CountryOption('IT', 'Italy'),
  CountryOption('PL', 'Poland'),
  CountryOption('NL', 'Netherlands'),
  CountryOption('TR', 'Turkey'),
  CountryOption('BR', 'Brazil'),
  CountryOption('MX', 'Mexico'),
  CountryOption('AR', 'Argentina'),
  CountryOption('CA', 'Canada'),
  CountryOption('IN', 'India'),
  CountryOption('ID', 'Indonesia'),
  CountryOption('PH', 'Philippines'),
  CountryOption('JP', 'Japan'),
  CountryOption('KR', 'South Korea'),
  CountryOption('CN', 'China'),
  CountryOption('VN', 'Vietnam'),
  CountryOption('TH', 'Thailand'),
  CountryOption('AU', 'Australia'),
  CountryOption('NZ', 'New Zealand'),
  CountryOption('SE', 'Sweden'),
  CountryOption('NO', 'Norway'),
  CountryOption('FI', 'Finland'),
  CountryOption('DK', 'Denmark'),
  CountryOption('IE', 'Ireland'),
  CountryOption('PT', 'Portugal'),
  CountryOption('GR', 'Greece'),
  CountryOption('CZ', 'Czechia'),
  CountryOption('RO', 'Romania'),
  CountryOption('HU', 'Hungary'),
  CountryOption('AT', 'Austria'),
  CountryOption('CH', 'Switzerland'),
  CountryOption('BE', 'Belgium'),
  CountryOption('KZ', 'Kazakhstan'),
  CountryOption('BY', 'Belarus'),
  CountryOption('GE', 'Georgia'),
  CountryOption('AM', 'Armenia'),
  CountryOption('AZ', 'Azerbaijan'),
  CountryOption('UZ', 'Uzbekistan'),
  CountryOption('EG', 'Egypt'),
  CountryOption('SA', 'Saudi Arabia'),
  CountryOption('AE', 'United Arab Emirates'),
  CountryOption('IL', 'Israel'),
  CountryOption('ZA', 'South Africa'),
  CountryOption('NG', 'Nigeria'),
  CountryOption('KE', 'Kenya'),
  CountryOption('MA', 'Morocco'),
  CountryOption('CO', 'Colombia'),
  CountryOption('CL', 'Chile'),
  CountryOption('PE', 'Peru'),
  CountryOption('PK', 'Pakistan'),
  CountryOption('BD', 'Bangladesh'),
  CountryOption('MY', 'Malaysia'),
  CountryOption('SG', 'Singapore'),
  CountryOption('HK', 'Hong Kong'),
  CountryOption('TW', 'Taiwan'),
];

/// O(1) code → name lookup (uppercased keys).
final Map<String, String> kCountryNameByCode = {
  for (final c in kCountries) c.code: c.name,
};
