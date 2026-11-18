/**
 * NEO-597 — where each publisher posts its official checklists. The operator
 * opens one in a new tab, downloads the file there and brings it back to the
 * checklist picker. NeonBinder never fetches these pages (the publishers'
 * sites refuse automated requests), and no NB name or set data is put in the
 * address.
 *
 * One entry per publisher, in the order the links show: adding one is adding a
 * row here. Both links always show; nothing keys on `name`, which is only the
 * link's label.
 */
export type PublisherChecklistPage = {
  /** The publisher as a collector says it. */
  name: string;
  /** The publisher's own checklist page, as given. */
  url: string;
};

export const PUBLISHER_CHECKLIST_PAGES: readonly PublisherChecklistPage[] = [
  { name: "Topps", url: "https://www.topps.com/pages/checklists" },
  { name: "Panini", url: "https://www.paniniamerica.net/checklist.html" },
];
