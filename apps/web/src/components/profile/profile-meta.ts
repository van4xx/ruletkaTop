import type { Gender } from '@ruletka/shared-types';

/** Russian gender labels for display. */
export const GENDER_LABEL: Record<Gender, string> = {
  male: 'Мужской',
  female: 'Женский',
  other: 'Другое',
};

/** Decline "год/года/лет" for a Russian age string. */
export function ageLabel(age: number): string {
  const mod10 = age % 10;
  const mod100 = age % 100;
  let unit = 'лет';
  if (mod10 === 1 && mod100 !== 11) unit = 'год';
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) unit = 'года';
  return `${age} ${unit}`;
}
