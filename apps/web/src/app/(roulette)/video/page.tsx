import type { Metadata } from 'next';
import { RouletteStage } from '@/features/roulette/roulette-stage';

export const metadata: Metadata = {
  title: 'Видеорулетка',
  description:
    'Случайные видеозвонки с людьми со всего мира. Включи камеру, фильтруй по интересам и знакомься в один клик.',
};

export default function VideoRoulettePage() {
  return <RouletteStage type="video" />;
}
