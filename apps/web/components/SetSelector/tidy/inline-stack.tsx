import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

/**
 * Every inline part of a tidy tile (a search that is open, the New Team form,
 * the title editor, the set-name field) registers itself here while it is
 * open. Esc closes the part that holds focus (the one the operator is in), or
 * the most recently opened when focus is in none of them, and while anything is
 * open Enter and Esc never mean "Save & next" / "Save for later".
 */
type Entry = { id: number; close: () => void; scope?: RefObject<HTMLElement | null> };

type Stack = {
  register: (entry: Entry) => () => void;
  /**
   * Closes the open part that contains focus, else the most recently opened.
   * Returns false when nothing is open.
   */
  closeTop: () => boolean;
  count: number;
};

const InlineStackContext = createContext<Stack | null>(null);

export function InlineStackProvider({ children }: { children: ReactNode }) {
  const entriesRef = useRef<Entry[]>([]);
  const [count, setCount] = useState(0);

  const register = useCallback((entry: Entry) => {
    entriesRef.current = [...entriesRef.current, entry];
    setCount(entriesRef.current.length);
    return () => {
      entriesRef.current = entriesRef.current.filter((e) => e.id !== entry.id);
      setCount(entriesRef.current.length);
    };
  }, []);

  const closeTop = useCallback(() => {
    const entries = entriesRef.current;
    if (entries.length === 0) return false;
    const active = document.activeElement;
    // Newest first, so a part opened inside another (a New Team form inside a
    // tile that also has a search open) is the one that closes.
    const holder = active
      ? [...entries].reverse().find((e) => e.scope?.current?.contains(active))
      : undefined;
    (holder ?? entries[entries.length - 1]).close();
    return true;
  }, []);

  const value = useMemo<Stack>(
    () => ({ register, closeTop, count }),
    [register, closeTop, count],
  );
  return <InlineStackContext.Provider value={value}>{children}</InlineStackContext.Provider>;
}

let nextId = 1;

/**
 * Register an inline part while `open` is true. `close` is called when Esc
 * closes this part; keep it fresh, it is read through a ref. `scope` is the
 * element the part draws in: Esc with focus inside it closes it, whatever else
 * is open. Without one the part is only ever closed as the most recent.
 */
export function useInlinePart(
  open: boolean,
  close: () => void,
  scope?: RefObject<HTMLElement | null>,
): void {
  const stack = useContext(InlineStackContext);
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  const register = stack?.register;
  useEffect(() => {
    if (!open || !register) return;
    return register({ id: nextId++, close: () => closeRef.current(), scope });
  }, [open, register, scope]);
}

/** True while any inline part is open. */
export function useInlineStackOpen(): boolean {
  return (useContext(InlineStackContext)?.count ?? 0) > 0;
}

/** For the walk's key handler: close the top inline part, if any. */
export function useCloseTopInlinePart(): () => boolean {
  const stack = useContext(InlineStackContext);
  const closeTop = stack?.closeTop;
  return useCallback(() => closeTop?.() ?? false, [closeTop]);
}
