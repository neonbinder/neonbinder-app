import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Every inline part of a tidy tile (a search that is open, the New Team form,
 * the title editor, the set-name field) registers itself here while it is
 * open. Esc closes the top part first, and while anything is open Enter and
 * Esc never mean "Save & next" / "Save for later".
 */
type Entry = { id: number; close: () => void };

type Stack = {
  register: (entry: Entry) => () => void;
  /** Closes the most recently opened part. Returns false when nothing is open. */
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
    const top = entriesRef.current[entriesRef.current.length - 1];
    if (!top) return false;
    top.close();
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
 * reaches the top of the stack; keep it fresh, it is read through a ref.
 */
export function useInlinePart(open: boolean, close: () => void): void {
  const stack = useContext(InlineStackContext);
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  const register = stack?.register;
  useEffect(() => {
    if (!open || !register) return;
    return register({ id: nextId++, close: () => closeRef.current() });
  }, [open, register]);
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
