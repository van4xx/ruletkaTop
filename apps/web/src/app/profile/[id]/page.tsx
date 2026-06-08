import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { PublicProfile } from '@ruletka/shared-types';
import { ProfilePageShell } from '@/components/profile/profile-page-shell';
import { PublicProfileClient } from '@/features/profile/public-profile-client';

/** API base, e.g. `http://localhost:4000/api`, and the public site origin. */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const SITE_URL = API_BASE_URL.replace(/\/api\/?$/, '') || 'https://ruletka.top';

/**
 * Best-effort server fetch of the public profile for metadata only. Runs as an
 * UNAUTHENTICATED request (crawler-facing), so privacy-restricted profiles
 * simply 404 here and we fall back to the generic title. Never throws.
 */
async function fetchProfile(id: string): Promise<PublicProfile | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/profiles/${encodeURIComponent(id)}`, {
      // Short revalidation so a renamed/updated profile's card refreshes without
      // hammering the API on every crawl.
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return (await res.json()) as PublicProfile;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations('profile');
  const profile = await fetchProfile(id);

  // Per-user title when we could read the profile; the generic public title
  // otherwise (private / missing). Public profiles are personal pages — keep
  // them OUT of search indexes regardless.
  const title = profile ? t('meta.publicTitleNamed', { name: profile.nickname }) : t('meta.publicTitle');
  const description = profile
    ? t('meta.publicDescriptionNamed', { name: profile.nickname })
    : t('meta.publicDescription');

  // Resolve the avatar (server-relative path or absolute URL) into an absolute
  // OG image; fall back to the site default card when there's no avatar.
  const ogImage = profile?.avatarUrl
    ? profile.avatarUrl.startsWith('http')
      ? profile.avatarUrl
      : `${SITE_URL}${profile.avatarUrl}`
    : undefined;

  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      ...(ogImage ? { images: [{ url: ogImage, alt: profile?.nickname ?? '' }] } : {}),
    },
  };
}

/**
 * /profile/[id] — a public profile. `params` is async (App Router); the client
 * body loads the profile, presence and gifts, and exposes the action bar. The
 * server shell additionally fetches the profile in {@link generateMetadata} to
 * build a per-user title + OG image (kept out of search indexes).
 */
export default async function PublicProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ProfilePageShell>
      <PublicProfileClient profileId={id} />
    </ProfilePageShell>
  );
}
