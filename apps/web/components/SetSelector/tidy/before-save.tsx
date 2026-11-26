import { createContext, useContext, useEffect, useRef } from "react";

/**
 * NEO-657 — what a tile still has to write when the operator presses Save &
 * next.
 *
 * Most tiles save the moment they are answered, and the server's own defaults
 * ride on `markReviewed`. A form the operator has left open with something
 * addable in it (the new player's prefilled "+ Add stint") is the exception:
 * the walk asks each registered hook to write first, and moves on only when
 * every one reports it went through. A hook that returns false holds the card
 * (the walk says "Didn't save, try again"). A hook that wrote a stint to a
 * player says so (`wrote(playerId)`), so the walk does not also write its own
 * default stint for that player's career gap on top of what the form held.
 *
 * Outside a walk (a tile rendered alone) this is a no-op.
 */
export type BeforeSave = (wrote: (playerId: string) => void) => Promise<boolean>;

export type BeforeSaveRegistry = {
  register: (hook: BeforeSave) => () => void;
};

const BeforeSaveContext = createContext<BeforeSaveRegistry | null>(null);

export const BeforeSaveProvider = BeforeSaveContext.Provider;

/**
 * The walk's end: a registry, and the call that runs what is registered, in
 * order. `run(wrote)` adds each player a hook wrote to into `wrote`.
 */
export function createBeforeSaveRegistry(): {
  registry: BeforeSaveRegistry;
  run: (wrote?: Set<string>) => Promise<boolean>;
} {
  const hooks = new Set<BeforeSave>();
  return {
    registry: {
      register: (hook) => {
        hooks.add(hook);
        return () => {
          hooks.delete(hook);
        };
      },
    },
    run: async (wrote) => {
      for (const hook of [...hooks]) {
        if (!(await hook((playerId) => wrote?.add(playerId)))) return false;
      }
      return true;
    },
  };
}

/** Register `hook` while `active`; it is read through a ref, so keep it fresh freely. */
export function useBeforeSave(active: boolean, hook: BeforeSave): void {
  const registry = useContext(BeforeSaveContext);
  const hookRef = useRef(hook);
  useEffect(() => {
    hookRef.current = hook;
  });
  useEffect(() => {
    if (!active || !registry) return;
    return registry.register((wrote) => hookRef.current(wrote));
  }, [active, registry]);
}
