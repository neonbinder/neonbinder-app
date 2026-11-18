import { PUBLISHER_CHECKLIST_PAGES } from "@/lib/checklists/publisher-checklist-pages";

/**
 * NEO-597 — links out to the publishers' own checklist pages, beside the
 * checklist file pickers. Each opens in a new tab; the operator downloads the
 * file there and chooses it here. Both always show and the operator picks, so
 * the row is just the two labels, with no helper line.
 *
 * Same face as the app's other external links (blue text, underline, an sr-only
 * "(opens in new tab)"), at least 24px tall (WCAG 2.5.8) and 44px on a phone.
 */
const LINK =
  "inline-flex min-h-6 items-center rounded text-sm text-neon-blue-text underline underline-offset-2 transition-colors hover:text-neon-green-text focus-outline max-sm:min-h-11";

export default function PublisherChecklistLinks() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {PUBLISHER_CHECKLIST_PAGES.map((page) => (
        <a key={page.url} href={page.url} target="_blank" rel="noopener noreferrer" className={LINK}>
          {page.name} Checklists
          <span className="sr-only"> (opens in new tab)</span>
        </a>
      ))}
    </div>
  );
}
