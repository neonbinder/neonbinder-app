import { CheckCircleIcon } from "@heroicons/react/24/outline";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import NeonButton from "@/components/modules/NeonButton";
import { Input } from "@/components/primitives/Input";
import { MAX_SYNC_REPORT_NOTE } from "@/lib/collection/sync-report";
import type { SyncProblemSet } from "../fake-data";
import { MARKETPLACES } from "../dash-labels";
import type { Crew } from "./crew";

/**
 * NEO-536 — "Report to our crew", under a set holding back cards only the
 * crew can fix. Opens a short form in place (a note is optional): Enter
 * sends, Escape backs out. Sent, the set reads "Reported" for as long as the
 * report is open: that comes from the collector's open reports, not from
 * this form, so it holds on a reload and clears when the crew closes it or
 * the collector withdraws it. Focus follows: into the note on open, onto the
 * "Reported" line once sent (or, should the read not say "Reported" by the
 * render after the send, the button, so focus never sits nowhere waiting to
 * jump later), back to the button on Cancel.
 */
export default function ReportToCrew({
  crew,
  set,
  variantId,
}: {
  crew: Crew;
  /** The held-back set as the report names it: its label and the marketplace it is held back from. */
  set: Pick<SyncProblemSet, "setLabel" | "marketplace">;
  variantId: string;
}) {
  const market = MARKETPLACES[set.marketplace].name;
  const reported = crew.isReported(variantId, set.marketplace);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const errorId = useId();
  /**
   * Where focus goes on the next render: set by an open, a send or a cancel,
   * never on a fresh load. Spent by that render, whether its target is there
   * or not: a target that is missing falls back to the button.
   */
  const focusNext = useRef<"note" | "status" | "button" | null>(null);

  useEffect(() => {
    const want = focusNext.current;
    if (!want) return;
    focusNext.current = null;
    const el = want === "note" ? noteRef.current : want === "status" ? statusRef.current : buttonRef.current;
    (el ?? buttonRef.current)?.focus();
  });

  function cancel() {
    if (busy) return;
    setOpen(false);
    setNote("");
    setError(null);
    focusNext.current = "button";
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const why = await crew.report({ variantId, platform: set.marketplace, note });
    setBusy(false);
    if (why) {
      setError(why);
      return;
    }
    setOpen(false);
    setNote("");
    focusNext.current = "status";
  }

  if (reported && !open) {
    return (
      <p
        ref={statusRef}
        tabIndex={-1}
        className="mt-3 flex items-center gap-2 rounded-sm text-sm font-semibold text-neon-green-text focus-outline"
      >
        <CheckCircleIcon aria-hidden="true" className="size-5 shrink-0" />
        <span>
          Reported. Our crew&apos;s on it.
          <span className="sr-only">
            {" "}
            {set.setLabel} on {market}
          </span>
        </span>
      </p>
    );
  }

  if (!open) {
    return (
      <div className="mt-3">
        <NeonButton
          ref={buttonRef}
          variant="secondary"
          outline
          size="2"
          className="max-sm:min-h-11"
          onClick={() => {
            setOpen(true);
            focusNext.current = "note";
          }}
        >
          Report to our crew
          <span className="sr-only">
            {" "}
            about {set.setLabel} on {market}
          </span>
        </NeonButton>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => void send(e)}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          cancel();
        }
      }}
      className="mt-3 flex max-w-xl flex-col gap-2 rounded-md border border-rule bg-raised-deep p-3"
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink-2">
          Note for our crew (optional)
          <span className="sr-only">
            {" "}
            about {set.setLabel} on {market}
          </span>
        </span>
        <Input
          bare
          ref={noteRef}
          value={note}
          maxLength={MAX_SYNC_REPORT_NOTE}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything we should know?"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="w-full px-3 py-2 text-base sm:text-sm"
        />
      </label>
      {/* Mounted with the form, so a refusal is announced; empty, it cancels its own gap. */}
      <p id={errorId} role="alert" className="text-sm text-neon-pink-text empty:-mt-2">
        {error}
      </p>
      <div className="flex flex-wrap gap-2">
        <NeonButton type="submit" variant="primary" size="2" aria-disabled={busy || undefined} className="max-sm:min-h-11">
          {busy ? "Sending" : "Send"}
          <span className="sr-only"> report on {set.setLabel} on {market}</span>
        </NeonButton>
        <NeonButton type="button" variant="negative" outline size="2" onClick={cancel} className="max-sm:min-h-11">
          Cancel
          <span className="sr-only"> report on {set.setLabel} on {market}</span>
        </NeonButton>
      </div>
    </form>
  );
}
