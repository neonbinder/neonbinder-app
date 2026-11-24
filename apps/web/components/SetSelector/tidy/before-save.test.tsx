import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BeforeSaveProvider, createBeforeSaveRegistry, useBeforeSave } from "./before-save";

function Hook({ active, hook }: { active: boolean; hook: (wrote: (playerId: string) => void) => Promise<boolean> }) {
  useBeforeSave(active, hook);
  return null;
}

describe("before-save registry (NEO-657)", () => {
  it("runs nothing and passes when nothing is registered", async () => {
    expect(await createBeforeSaveRegistry().run()).toBe(true);
  });

  it("runs an active hook, and not one that is inactive", async () => {
    const { registry, run } = createBeforeSaveRegistry();
    const on = vi.fn().mockResolvedValue(true);
    const off = vi.fn().mockResolvedValue(true);
    render(
      <BeforeSaveProvider value={registry}>
        <Hook active hook={on} />
        <Hook active={false} hook={off} />
      </BeforeSaveProvider>,
    );
    expect(await run()).toBe(true);
    expect(on).toHaveBeenCalledTimes(1);
    expect(off).not.toHaveBeenCalled();
  });

  it("collects the players a hook says it wrote", async () => {
    const { registry, run } = createBeforeSaveRegistry();
    render(
      <BeforeSaveProvider value={registry}>
        <Hook
          active
          hook={async (wrote) => {
            wrote("p1");
            return true;
          }}
        />
      </BeforeSaveProvider>,
    );
    const wrote = new Set<string>();
    expect(await run(wrote)).toBe(true);
    expect([...wrote]).toEqual(["p1"]);
  });

  it("a hook that reports false stops the run", async () => {
    const { registry, run } = createBeforeSaveRegistry();
    const later = vi.fn().mockResolvedValue(true);
    render(
      <BeforeSaveProvider value={registry}>
        <Hook active hook={async () => false} />
        <Hook active hook={later} />
      </BeforeSaveProvider>,
    );
    expect(await run()).toBe(false);
    expect(later).not.toHaveBeenCalled();
  });

  it("a hook that unmounts is gone", async () => {
    const { registry, run } = createBeforeSaveRegistry();
    const hook = vi.fn().mockResolvedValue(true);
    const view = render(
      <BeforeSaveProvider value={registry}>
        <Hook active hook={hook} />
      </BeforeSaveProvider>,
    );
    view.unmount();
    await run();
    expect(hook).not.toHaveBeenCalled();
  });

  it("outside a walk it is a no-op", () => {
    expect(() => render(<Hook active hook={async () => true} />)).not.toThrow();
  });
});
