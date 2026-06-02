import type { Metadata } from 'next';
import { RouletteStage } from '@/features/roulette/roulette-stage';

export const metadata: Metadata = {
  title: 'Голосовая рулетка',
  description:
    'Голосовое общение со случайными собеседниками — без камеры. Чистый звук, живой эквалайзер и мгновенный коннект.',
};

export default function VoiceRoulettePage() {
  return <RouletteStage type="voice" />;
}
