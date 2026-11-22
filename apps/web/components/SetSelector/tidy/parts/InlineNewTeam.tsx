import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { userFacingMessage } from "../../../../lib/errors/user-facing-message";
import {
  aliasHolderStatement,
  teamEraProblem,
  teamOptionLabel,
} from "../../../../lib/teams/team-era";
import { useStaleWhileLoading } from "../../../../src/hooks/useStaleWhileLoading";
import NeonButton from "../../../modules/NeonButton";
import { aliasHolderRefusal, teamEraRefusal } from "../../NewTeamDialog";
import { parseAliases } from "../../NewLeagueForm";
import NewTeamForm, {
  draftFullName,
  newTeamPrefill,
  type NewTeamDraft,
} from "../../NewTeamForm";
import { useInlinePart } from "../inline-stack";
import { aliasHolderSentence } from "./copy";

/**
 * NEO-645 — "New team", opened INSIDE the tile that needs it.
 *
 * Jason: "just open inline components that do the work". This is the dialog's
 * `NewTeamDialog` without the dialog: the same `NewTeamForm` (Location, Team
 * name, years, aliases, League) and the same `teams.findOrCreate` write, with
 * the same two questions the dialog asks of a refusal:
 *
 *  - a name that already has eras (`TEAM_ERA_EXISTS`) and a name another team
 *    answers to as an alias (`TEAM_NAME_IS_ALIAS`) are QUESTIONS, not failures.
 *    The refusal is read by its structured code, the form says which eras or
 *    which team, and the next press re-sends with `newEra: true`.
 *  - NEO-307: a name another team holds as an alias WITH overlapping years is
 *    refused outright, so it is asked ahead of the click
 *    (`teams.nameHeldAsAliasBy`) and the holder is offered as a link instead
 *    ("Link to {holder}", `onUseExisting`). Creation is held while it stands.
 *
 * A league typed into the League field is created outright
 * (`leagues.createByAdmin` through `NewTeamForm`'s picker shape), so there is no
 * later step to defer it to.
 *
 * One at a time: two of these in one walk would carry two controls named "New
 * team name", so opening one closes the other (`claimNewTeamForm`). Registers
 * with the walk's inline stack: Esc closes it first, and while it is open
 * Enter and Esc never mean Save & next / Save for later.
 */

let activeForm: { key: string; close: () => void } | null = null;

/** Claim the one open New team form in the walk; the previous holder is closed. */
function claimNewTeamForm(key: string, close: () => void): () => void {
  if (activeForm && activeForm.key !== key) activeForm.close();
  const mine = { key, close };
  activeForm = mine;
  return () => {
    if (activeForm === mine) activeForm = null;
  };
}

const NO_HOLDERS: ReadonlyArray<never> = [];

/**
 * NEO-645 — what a lookup said about the team that is not a form field: the
 * era, the colours and the ESPN / Wikidata ids. It rides along on the create
 * and is kept by the server on a NEW row only (`teams.findOrCreate`
 * `enrichment`), as the review wizard's commit used to write it. Assistive:
 * the operator's own answers win, and nothing here is shown or asked.
 */
export type TeamLookupCarry = {
  yearsActive?: { from: number; to?: number };
  colors?: { primary?: string; secondary?: string };
  espnId?: string;
  wikidataId?: string;
};

/** The carry-able slice of a stored name row's enrichment (or a career entry), nothing else. */
export function teamLookupCarryOf(source: TeamLookupCarry | null | undefined): TeamLookupCarry | undefined {
  if (!source) return undefined;
  const out: TeamLookupCarry = {
    ...(source.yearsActive ? { yearsActive: source.yearsActive } : {}),
    ...(source.colors ? { colors: source.colors } : {}),
    ...(source.espnId ? { espnId: source.espnId } : {}),
    ...(source.wikidataId ? { wikidataId: source.wikidataId } : {}),
  };
  return Object.keys(out).length > 0 ? out : undefined;
}

export default function InlineNewTeam({
  formKey,
  sportId,
  initialName,
  espnLocation,
  leagueSuggestion,
  carry,
  neededBy,
  createLabel,
  createAriaLabel,
  onCreated,
  onUseExisting,
  onClose,
  disabled = false,
}: {
  /** Unique per place the form can open from; see `claimNewTeamForm`. */
  formKey: string;
  sportId: Id<"selectorOptions">;
  initialName: string;
  /** A location a lookup returned; used only when it is a whole-word prefix of the name. */
  espnLocation?: string;
  /** A league name a lookup proposed, for the form's extra option. */
  leagueSuggestion?: string;
  /** The rest of the lookup's answer, kept on the new team (see `TeamLookupCarry`). */
  carry?: TeamLookupCarry;
  /** "Needed by: Mike Trout": why the form is open, when it was not asked for directly. */
  neededBy?: string;
  /** The visible words of the create button: "Create team" / "Create team and add stint". */
  createLabel: string;
  /** The create button's accessible name for a composed team name. */
  createAriaLabel: (fullName: string, creating: boolean) => string;
  /** The team that now exists. The caller attaches it (link the name, add the stint). */
  onCreated: (teamId: Id<"teams">) => Promise<void> | void;
  /** The name is already another team's alias: "Link to {holder}". */
  onUseExisting?: (teamId: Id<"teams">, name: string) => void;
  onClose: () => void;
  disabled?: boolean;
}) {
  const findOrCreate = useMutation(api.teams.findOrCreate);
  const createLeague = useMutation(api.leagues.createByAdmin);
  const [draft, setDraft] = useState<NewTeamDraft>(() =>
    newTeamPrefill({ name: initialName, location: espnLocation }),
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const createButtonRef = useRef<HTMLButtonElement | null>(null);

  useInlinePart(true, onClose);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => claimNewTeamForm(formKey, () => closeRef.current()), [formKey]);

  // Opens on the field the operator came to type in: nothing here is
  // destructive, so the safe thing and the intended thing coincide.
  useEffect(() => {
    nameInputRef.current?.focus({ preventScroll: true });
  }, []);

  // Disabling the focused input would drop focus to <body>; the create button
  // stays focusable (aria-disabled) and takes it for the length of the write.
  useEffect(() => {
    if (creating) createButtonRef.current?.focus();
  }, [creating]);

  const fullName = draftFullName(draft);
  const blocked = draft.name.trim() ? null : "Enter a team name.";

  // "Yes, I mean a second era of a name we already hold": re-armed by a
  // refusal, forgotten when the name or location changes (the refusal was
  // about THAT name).
  const [confirmNewEra, setConfirmNewEra] = useState(false);
  const draftIdentity = `${draft.location.trim()}|${draft.name.trim()}`;
  const [confirmedFor, setConfirmedFor] = useState(draftIdentity);
  if (confirmedFor !== draftIdentity) {
    setConfirmedFor(draftIdentity);
    setConfirmNewEra(false);
  }

  // NEO-307 / NEO-602: the teams that already answer to the composed name as an
  // ALIAS with overlapping years. Only a valid era is sent while typing.
  const aliasCheckName = fullName.trim();
  const aliasCheckYears =
    draft.yearsActive && teamEraProblem(draft.yearsActive) === null ? draft.yearsActive : undefined;
  const holdersLive = useQuery(
    api.teams.nameHeldAsAliasBy,
    aliasCheckName
      ? {
          sportId,
          name: aliasCheckName,
          ...(aliasCheckYears ? { yearsActive: aliasCheckYears } : {}),
        }
      : "skip",
  );
  const holders = useStaleWhileLoading(
    aliasCheckName ? holdersLive : NO_HOLDERS,
    `${formKey}|${aliasCheckName ? "name" : "none"}`,
  );
  const clash = holders?.[0];

  const create = async () => {
    if (creating || disabled) return;
    if (blocked) {
      setError(blocked);
      return;
    }
    if (clash) {
      setError(aliasHolderSentence(clash, aliasCheckYears));
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const location = draft.location.trim();
      const aliases = parseAliases(draft.aliases);
      // The league suggestion is what the League field shows while nothing was
      // picked, so the server writes it (link-only) when no league was answered.
      const suggested = leagueSuggestion?.trim();
      const enrichment = {
        ...(suggested ? { league: suggested } : {}),
        ...(carry ?? {}),
      };
      const id = await findOrCreate({
        name: draft.name.trim(),
        sportId,
        ...(location ? { location } : {}),
        // `null` is the operator's "no league"; an omitted key is "not answered".
        ...(draft.leagueId !== undefined ? { leagueId: draft.leagueId } : {}),
        ...(draft.leagueName ? { leagueName: draft.leagueName } : {}),
        ...(draft.yearsActive ? { yearsActive: draft.yearsActive } : {}),
        ...(confirmNewEra ? { newEra: true } : {}),
        ...(aliases.length > 0 ? { aliases } : {}),
        ...(Object.keys(enrichment).length > 0 ? { enrichment } : {}),
      });
      try {
        await onCreated(id);
      } catch (err) {
        // The team exists now; only the attaching failed. Say so, and keep the
        // form open so the operator can try the attach again (find-or-create
        // returns the same row).
        setError(userFacingMessage(err, "The team was created, but it could not be attached. Try again."));
        return;
      }
      onClose();
    } catch (err) {
      // By structured `code`, never by prose (see NewTeamDialog): the refusal
      // is a question and its answer is the next press.
      const existing = teamEraRefusal(err);
      const aliasHolders = existing ? null : aliasHolderRefusal(err);
      if (aliasHolders) {
        setConfirmNewEra(true);
        setError(
          `${aliasHolders
            .map((holder) => aliasHolderStatement(teamOptionLabel(holder.name, holder.yearsActive)))
            .join(" ")} This team's years don't overlap, so Create again to add it as its own team.`,
        );
      } else if (existing) {
        setConfirmNewEra(true);
        setError(
          `${fullName || draft.name.trim()} already exists for ${existing
            .map((era) => era.years || "no years yet")
            .join(", ")}. Create again to add this as a second era.`,
        );
      } else {
        setError(userFacingMessage(err, "Could not create team."));
      }
    } finally {
      setCreating(false);
    }
  };

  const busy = creating || disabled;
  const createDisabled = busy || blocked !== null || clash !== undefined;

  return (
    <div
      role="group"
      aria-label={`New team: ${initialName.trim() || "unnamed"}`}
      className="grid gap-2 rounded-lg border border-rule bg-raised-deep p-2.5"
    >
      <p className="text-xs font-medium text-ink">
        New team{initialName.trim() ? `: ${initialName.trim()}` : ""}
      </p>
      <NewTeamForm
        sportId={sportId}
        draft={draft}
        onChange={(patch) => {
          // A refusal described the values that were in the boxes; the next
          // keystroke makes it stale.
          setError(null);
          setDraft((prev) => ({ ...prev, ...patch }));
        }}
        leagueSuggestion={leagueSuggestion}
        neededBy={neededBy}
        onCreateLeague={async (leagueDraft) => {
          const level = leagueDraft.level;
          if (level === null) {
            throw new Error("InlineNewTeam: league create without a level");
          }
          const { id } = await createLeague({
            name: leagueDraft.name.trim(),
            sportId,
            level,
            ...(leagueDraft.abbreviation.trim()
              ? { abbreviation: leagueDraft.abbreviation.trim() }
              : {}),
            ...(leagueDraft.fromYear.trim()
              ? {
                  yearsActive: {
                    from: Number(leagueDraft.fromYear.trim()),
                    ...(leagueDraft.toYear.trim() ? { to: Number(leagueDraft.toYear.trim()) } : {}),
                  },
                }
              : {}),
            ...(parseAliases(leagueDraft.aliases).length
              ? { aliases: parseAliases(leagueDraft.aliases) }
              : {}),
            ...(leagueDraft.wikidataId.trim() ? { wikidataId: leagueDraft.wikidataId.trim() } : {}),
          });
          return { id, name: leagueDraft.name.trim() };
        }}
        onLeagueStatus={(status) => setError(status.isError ? status.text : null)}
        describedBy={error ? errorId : undefined}
        nameInputRef={nameInputRef}
        disabled={busy}
        onSubmit={() => void create()}
      />

      {clash && (
        <div className="grid gap-2 rounded-md border border-neon-pink-text/40 bg-neon-pink/10 p-2.5">
          <p className="text-sm text-neon-pink-text">{aliasHolderSentence(clash, aliasCheckYears)}</p>
          {onUseExisting && (
            <div className="flex flex-wrap gap-2">
              {(holders ?? []).map((holder) => (
                <NeonButton
                  key={holder.id}
                  size="1"
                  className="h-auto min-h-6 max-w-full py-1 wrap-anywhere"
                  aria-disabled={busy ? true : undefined}
                  onClick={() => {
                    if (busy) return;
                    onUseExisting(holder.id, holder.name);
                  }}
                >
                  {`Link to ${teamOptionLabel(holder.name, holder.yearsActive)}`}
                </NeonButton>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <p id={errorId} role="alert" className="text-sm text-neon-pink-text">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <NeonButton
          ref={createButtonRef}
          type="button"
          size="1"
          // `aria-disabled`, never native: a keyboard operator who tabbed here
          // is not ejected for the length of a round trip.
          aria-disabled={createDisabled ? true : undefined}
          aria-label={createAriaLabel(fullName, creating)}
          onClick={() => void create()}
        >
          {creating ? "Creating…" : createLabel}
        </NeonButton>
        <NeonButton
          type="button"
          size="1"
          variant="negative"
          outline
          aria-label="Cancel new team"
          aria-disabled={creating ? true : undefined}
          onClick={() => {
            if (!creating) onClose();
          }}
        >
          Cancel
        </NeonButton>
      </div>
    </div>
  );
}
