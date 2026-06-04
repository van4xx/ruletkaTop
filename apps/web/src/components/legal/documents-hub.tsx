'use client';

/**
 * The «Документы» hub at `/documents` — the four legal/info documents bound
 * together and presented "as a book": a sticky spine (the table of contents on
 * the left) and a reading pane on the right that flips between documents
 * client-side. Each document's body + metadata is reused verbatim from the
 * shared {@link DOCUMENTS} registry, so there is zero copy duplication with the
 * standalone `/about`, `/rules`, `/privacy`, `/help` pages.
 *
 * The hub keeps the brand's atmospheric chrome (aurora glows, grain, grid) and
 * motion voice. The active document is reflected in the URL hash (`#rules`) so
 * a chosen chapter is linkable and survives a refresh / back-forward.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { BookOpen, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { DOCUMENTS, type DocDescriptor } from './documents';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

const rise: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE_OUT } },
};

const page: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE_OUT } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2, ease: EASE_OUT } },
};

type DocId = DocDescriptor['id'];

/** The registry is non-empty; this is the canonical "first page" of the book. */
const FIRST_DOC: DocDescriptor = DOCUMENTS[0]!;

/** Reads the current document id from the URL hash, falling back to the first. */
function readHashDoc(): DocId | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace('#', '');
  return DOCUMENTS.some((d) => d.id === hash) ? (hash as DocId) : null;
}

/** Tracks which section of the active document is nearest the top of the view. */
function useScrollSpy(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  const key = ids.join('|');

  useEffect(() => {
    setActive(ids[0] ?? null);
    if (typeof IntersectionObserver === 'undefined' || ids.length === 0) return;
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));

    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.set(entry.target.id, entry.intersectionRatio);
          else visible.delete(entry.target.id);
        }
        let best: string | null = null;
        for (const id of ids) {
          if (visible.has(id)) {
            best = id;
            break;
          }
        }
        if (best) setActive(best);
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: [0, 0.25, 0.5, 1] },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return active;
}

export function DocumentsHub() {
  const t = useTranslations('legal');
  const [activeId, setActiveId] = useState<DocId>(FIRST_DOC.id);
  const topRef = useRef<HTMLDivElement>(null);
  const mobilePickerRef = useRef<HTMLDivElement>(null);
  const didMount = useRef(false);

  // Sync the active document with the URL hash (deep-linkable chapters).
  useEffect(() => {
    const fromHash = readHashDoc();
    if (fromHash) setActiveId(fromHash);
    const onHashChange = () => {
      const next = readHashDoc();
      if (next) setActiveId(next);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const activeDoc = DOCUMENTS.find((d) => d.id === activeId) ?? FIRST_DOC;
  const sectionToc = activeDoc.toc(t);
  const activeSection = useScrollSpy(sectionToc.map((s) => s.id));

  const selectDoc = useCallback((id: DocId) => {
    setActiveId(id);
    if (typeof window !== 'undefined') {
      history.replaceState(null, '', `#${id}`);
    }
  }, []);

  // When the reader flips to a new document, scroll the reading pane back to
  // its top (but never on the initial mount / deep-link).
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [activeId]);

  // Keep the active chip centered in the mobile picker rail.
  useEffect(() => {
    const chip = mobilePickerRef.current?.querySelector<HTMLButtonElement>(
      `[data-doc="${activeId}"]`,
    );
    chip?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [activeId]);

  const ActiveBody = activeDoc.Body;

  return (
    <div className="grain relative overflow-hidden">
      {/* Atmospheric background — matches the legal pages' voice. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-48 left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,var(--color-neon-violet)_0%,transparent_60%)] opacity-[0.18] blur-3xl" />
        <div className="absolute -right-28 top-24 h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-cyan)_0%,transparent_60%)] opacity-[0.12] blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:64px_64px] opacity-[0.1] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
      </div>

      {/* Hub hero */}
      <section className="mx-auto max-w-6xl px-4 pb-2 pt-12 sm:px-6 sm:pt-16 lg:px-8">
        <motion.header variants={rise} initial="hidden" animate="show" className="max-w-3xl">
          <span className="glass-panel mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5 text-[var(--color-neon-cyan)]" aria-hidden="true" />
            {t('hub.eyebrow')}
          </span>
          <h1 className="font-display text-3xl font-extrabold leading-[1.06] tracking-tight sm:text-5xl">
            {t('hub.title1')} <span className="text-gradient-neon">{t('hub.title2')}</span>
          </h1>
          <p className="mt-4 text-balance text-base text-muted-foreground sm:text-lg">
            {t('hub.lede')}
          </p>
        </motion.header>
      </section>

      {/* Mobile document picker — horizontal rail, sticky under the header. */}
      <nav
        aria-label={t('hub.contents')}
        className="sticky top-16 z-30 mt-6 border-y border-border/60 bg-background/70 backdrop-blur lg:hidden"
      >
        <div
          ref={mobilePickerRef}
          className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 py-3 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {DOCUMENTS.map((doc) => {
            const Icon = doc.icon;
            const isActive = doc.id === activeId;
            return (
              <button
                key={doc.id}
                type="button"
                data-doc={doc.id}
                onClick={() => selectDoc(doc.id)}
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/15 text-foreground ring-1 ring-primary/40'
                    : 'bg-card/50 text-muted-foreground ring-1 ring-border/60',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {doc.label(t)}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Book body */}
      <section className="mx-auto max-w-6xl px-4 pb-24 pt-10 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[18rem_1fr] lg:gap-14">
          {/* The spine / table of contents (desktop). */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-6">
              <div>
                <p className="mb-3 px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {t('hub.contents')}
                </p>
                <ul className="space-y-2">
                  {DOCUMENTS.map((doc, i) => {
                    const Icon = doc.icon;
                    const isActive = doc.id === activeId;
                    return (
                      <li key={doc.id}>
                        <button
                          type="button"
                          onClick={() => selectDoc(doc.id)}
                          aria-current={isActive ? 'true' : undefined}
                          className={cn(
                            'group relative flex w-full items-start gap-3 overflow-hidden rounded-xl border p-3 text-left transition-all',
                            isActive
                              ? 'border-primary/40 bg-primary/[0.07] shadow-[0_0_0_1px_var(--color-primary)/10]'
                              : 'border-border/60 bg-card/30 hover:border-border hover:bg-card/50',
                          )}
                        >
                          {/* Active accent bar (the "ribbon"). */}
                          <span
                            aria-hidden="true"
                            className={cn(
                              'absolute inset-y-0 left-0 w-0.5 rounded-r bg-gradient-to-b from-[var(--color-neon-violet)] to-[var(--color-neon-magenta)] transition-opacity',
                              isActive ? 'opacity-100' : 'opacity-0',
                            )}
                          />
                          <span
                            className={cn(
                              'mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 transition-colors',
                              isActive
                                ? 'bg-primary/15 text-primary ring-primary/30'
                                : 'bg-card/70 text-muted-foreground ring-border/70 group-hover:text-foreground',
                            )}
                          >
                            <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-2">
                              <span
                                aria-hidden="true"
                                className="font-display text-xs font-bold tabular-nums text-muted-foreground/60"
                              >
                                {String(i + 1).padStart(2, '0')}
                              </span>
                              <span
                                className={cn(
                                  'font-display text-sm font-semibold tracking-tight',
                                  isActive ? 'text-foreground' : 'text-foreground/90',
                                )}
                              >
                                {doc.label(t)}
                              </span>
                            </span>
                            <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                              {doc.tagline(t)}
                            </span>
                          </span>
                        </button>

                        {/* Nested section list for the open document. */}
                        <AnimatePresence initial={false}>
                          {isActive && sectionToc.length > 0 && (
                            <motion.ul
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.28, ease: EASE_OUT }}
                              className="ml-[1.85rem] mt-1 space-y-0.5 overflow-hidden border-l border-border/60"
                            >
                              {sectionToc.map((s) => {
                                const isCurrent = activeSection === s.id;
                                return (
                                  <li key={s.id}>
                                    <a
                                      href={`#${s.id}`}
                                      aria-current={isCurrent ? 'true' : undefined}
                                      className={cn(
                                        '-ml-px block border-l-2 py-1 pl-3 text-[0.8rem] transition-colors',
                                        isCurrent
                                          ? 'border-[var(--color-neon-violet)] font-medium text-foreground'
                                          : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                                      )}
                                    >
                                      {s.label}
                                    </a>
                                  </li>
                                );
                              })}
                            </motion.ul>
                          )}
                        </AnimatePresence>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </aside>

          {/* The open page of the book. */}
          <div ref={topRef} className="min-w-0 scroll-mt-28">
            <AnimatePresence mode="wait">
              <motion.article
                key={activeDoc.id}
                variants={page}
                initial="hidden"
                animate="show"
                exit="exit"
                className="min-w-0"
              >
                {/* Per-document header. */}
                <header className="mb-10 max-w-2xl border-b border-border/60 pb-8">
                  <span className="glass-panel mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-muted-foreground">
                    {activeDoc.eyebrow(t)}
                  </span>
                  <h2 className="font-display text-3xl font-extrabold leading-[1.08] tracking-tight sm:text-4xl">
                    {activeDoc.title(t)}
                  </h2>
                  <p className="mt-3 text-balance text-base text-muted-foreground">
                    {activeDoc.lede(t)}
                  </p>
                  {activeDoc.updatedAt && (
                    <p className="mt-3 text-xs text-muted-foreground/70">
                      {t('layout.lastUpdated')} <time>{activeDoc.updatedAt(t)}</time>
                    </p>
                  )}
                </header>

                {/* The long-form body, reused from the registry. */}
                <div className="max-w-2xl space-y-12">
                  <ActiveBody />
                </div>

                {/* Footer pager — flip to the next document. */}
                <DocPager activeId={activeId} onSelect={selectDoc} />
              </motion.article>
            </AnimatePresence>
          </div>
        </div>
      </section>
    </div>
  );
}

/** "Next document" affordance at the bottom of each page of the book. */
function DocPager({ activeId, onSelect }: { activeId: DocId; onSelect: (id: DocId) => void }) {
  const t = useTranslations('legal');
  const index = DOCUMENTS.findIndex((d) => d.id === activeId);
  const next = DOCUMENTS[(index + 1) % DOCUMENTS.length] ?? FIRST_DOC;
  const NextIcon = next.icon;

  return (
    <div className="mt-14 max-w-2xl border-t border-border/60 pt-8">
      <button
        type="button"
        onClick={() => onSelect(next.id)}
        className="group flex w-full items-center justify-between gap-4 rounded-2xl border border-border/60 bg-card/30 p-4 text-left transition-all hover:border-primary/40 hover:bg-card/50"
      >
        <span className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/20">
            <NextIcon className="h-5 w-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {t('hub.next')}
            </span>
            <span className="font-display text-base font-semibold tracking-tight text-foreground">
              {next.label(t)}
            </span>
          </span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
      </button>
    </div>
  );
}
