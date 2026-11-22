/**
 * NEO-356 — tokens.ts mirrors app/theme.css. These cases read the stylesheet
 * and fail on any drift, then hold the light palette to the contrast the
 * ticket promises (text 4.5:1, field and control edges 3:1).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  cssColorToHex,
  SURFACE_ROLES,
  surfaceHex,
  TEXT_NEVER_ON,
  tokenHex,
  TOKENS,
  type SurfaceRole,
  type TextRole,
  type TokenRole,
} from "./tokens";

// Read from disk: vitest stubs CSS imports (even `?raw`) to an empty string.
const themeCss = readFileSync(join(__dirname, "../../app/theme.css"), "utf8");

/** The custom properties declared directly in the first block whose selector starts with `head`. */
function block(head: string): Record<string, string> {
  const start = themeCss.indexOf(head);
  if (start < 0) throw new Error(`theme.css has no block "${head}"`);
  const open = themeCss.indexOf("{", start);
  const close = themeCss.indexOf("\n}", open);
  const body = themeCss
    .slice(open + 1, close)
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

const dark = block(':root,\n[data-theme="dark"]');
const light = { ...dark, ...block('[data-theme="light"] {') };

describe("tokens.ts mirrors app/theme.css", () => {
  for (const [mode, css] of [
    ["dark", dark],
    ["light", light],
  ] as const) {
    it(`every ${mode} role matches the stylesheet`, () => {
      for (const [role, value] of Object.entries(TOKENS[mode])) {
        expect({ role, value: css[role] }).toEqual({ role, value });
      }
    });
  }

  it("every role a component can paint with has a Tailwind colour", () => {
    for (const role of Object.keys(TOKENS.dark)) {
      expect(themeCss).toContain(`--color-${role}: var(--${role});`);
    }
  });
});

describe("cssColorToHex", () => {
  it("converts the notations theme.css uses", () => {
    expect(cssColorToHex("#ABC")).toBe("#aabbcc");
    expect(cssColorToHex("#00D558")).toBe("#00d558");
    // Tailwind's own hex for these steps.
    expect(cssColorToHex("oklch(27.8% 0.033 256.848)")).toBe("#1e2939"); // gray-800
    expect(cssColorToHex("oklch(20.8% 0.042 265.755)")).toBe("#0f172b"); // slate-900
  });

  it("refuses anything else rather than guess", () => {
    expect(() => cssColorToHex("rebeccapurple")).toThrow();
  });
});

describe("light palette contrast (NEO-356 spec)", () => {
  const on = (fg: TokenRole, bg: TokenRole) => contrastRatio(tokenHex(fg, "light"), tokenHex(bg, "light"));
  const textRoles: TokenRole[] = [
    "ink",
    "ink-2",
    "ink-3",
    "neon-green-text",
    "neon-pink-text",
    "neon-blue-text",
    "neon-yellow-text",
    "neon-orange-text",
    "neon-teal-text",
    "neon-purple-text",
  ];

  it("text roles reach 4.5:1 on the page, a sheet and a hovered row", () => {
    for (const fg of textRoles) {
      for (const bg of ["surface", "raised", "hover", "row", "row-hover", "hover-raised", "list-hover"] as TokenRole[]) {
        expect({ fg, bg, ok: on(fg, bg) >= 4.5 }).toEqual({ fg, bg, ok: true });
      }
    }
  });

  it("field and control edges, focus and the selection line reach 3:1", () => {
    for (const fg of ["field-rule", "control", "focus", "selection", "pip-owned", "pip-want", "spot"] as TokenRole[]) {
      for (const bg of ["surface", "raised"] as TokenRole[]) {
        expect({ fg, bg, ok: on(fg, bg) >= 3 }).toEqual({ fg, bg, ok: true });
      }
    }
  });

  it("ink reads on a neutral chip and a neutral button", () => {
    for (const fg of ["ink", "ink-2", "ink-3"] as TokenRole[]) {
      for (const bg of ["chip", "chip-strong", "button-neutral", "button-neutral-hover"] as TokenRole[]) {
        expect({ fg, bg, ok: on(fg, bg) >= 4.5 }).toEqual({ fg, bg, ok: true });
      }
    }
  });

  it("the selection line reaches 3:1 on every pick fill and on a row", () => {
    for (const bg of ["row", ...PICK_HUES.map((h) => `pick-${h}` as TokenRole)]) {
      expect({ bg, ok: on("selection-line", bg as TokenRole) >= 3 }).toEqual({ bg, ok: true });
    }
  });

  it("black ink reads on every neon fill", () => {
    for (const fill of ["neon-green", "neon-pink", "neon-blue", "neon-yellow", "neon-orange", "neon-teal", "neon-purple"] as TokenRole[]) {
      expect({ fill, ok: contrastRatio("#000000", tokenHex(fill, "light")) >= 4.5 }).toEqual({ fill, ok: true });
    }
  });
});

describe("the divider (rule), both modes", () => {
  // A divider is quiet, not a control: it has no 3:1 bar. It must still show on every ground it is
  // drawn on (dark's old rule was the graphite card's own tone, 1.00:1, so a divider in a raised panel
  // vanished), and stay a step under rule-strong, the card and panel edge.
  for (const mode of ["dark", "light"] as const) {
    it(`${mode}: rule shows on surface, raised and raised-deep, and is quieter than rule-strong on each`, () => {
      for (const bg of ["surface", "raised", "raised-deep"] as TokenRole[]) {
        const rule = contrastRatio(tokenHex("rule", mode), tokenHex(bg, mode));
        const strong = contrastRatio(tokenHex("rule-strong", mode), tokenHex(bg, mode));
        expect({ bg, shows: rule >= 1.2, quieter: rule < strong }).toEqual({ bg, shows: true, quieter: true });
      }
    });
  }
});

const PICK_HUES = ["pink", "blue", "green", "purple", "orange", "teal", "amber", "red", "emerald"] as const;

describe("hued picks and badges, both modes", () => {
  for (const mode of ["dark", "light"] as const) {
    it(`${mode}: each hue's ink reads 4.5:1 on its fill`, () => {
      for (const hue of PICK_HUES) {
        const ratio = contrastRatio(tokenHex(`pick-${hue}-ink`, mode), tokenHex(`pick-${hue}`, mode));
        expect({ hue, ok: ratio >= 4.5 }).toEqual({ hue, ok: true });
      }
    });
  }

  it("light: each hue's edge reaches 3:1 on its fill and on a sheet", () => {
    for (const hue of PICK_HUES) {
      for (const bg of [`pick-${hue}`, "raised"] as TokenRole[]) {
        const ratio = contrastRatio(tokenHex(`pick-${hue}-rule`, "light"), tokenHex(bg, "light"));
        expect({ hue, bg, ok: ratio >= 3 }).toEqual({ hue, bg, ok: true });
      }
    }
  });
});

describe("paper", () => {
  it("is white with black ink in both modes", () => {
    for (const mode of ["dark", "light"] as const) {
      expect([TOKENS[mode].paper, TOKENS[mode]["on-paper"]]).toEqual(["#ffffff", "#000000"]);
    }
  });
});

describe("NeonButton's fills (NEO-356)", () => {
  // primary, secondary, tertiary and negative: green, blue, violet and pink.
  const FILLS = ["neon-green", "neon-blue", "neon-purple", "neon-pink"] as const;

  for (const [mode, css] of [
    ["dark", dark],
    ["light", light],
  ] as const) {
    it(`${mode}: black ink reads 4.5:1 on every button fill`, () => {
      for (const fill of FILLS) {
        const ratio = contrastRatio("#000000", tokenHex(fill, mode));
        expect({ fill, ok: ratio >= 4.5 }).toEqual({ fill, ok: true });
      }
    });

    it(`${mode}: black ink reads 4.5:1 on the violet fill under the pointer`, () => {
      // Opaque in both modes: an 85% fade over the black page drops it to ~3.9:1.
      const hover = cssColorToHex(css["neon-purple-hover"]);
      expect(contrastRatio("#000000", hover)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("violet as text reads 4.5:1 on the page and a card in both modes (the tertiary outline)", () => {
    for (const mode of ["dark", "light"] as const) {
      for (const bg of ["surface", "raised"] as TokenRole[]) {
        const ratio = contrastRatio(tokenHex("neon-purple-text", mode), tokenHex(bg, mode));
        expect({ mode, bg, ok: ratio >= 4.5 }).toEqual({ mode, bg, ok: true });
      }
    }
  });
});

describe("named pairs a screen relies on (DESIGN.md, Notices)", () => {
  // Reconcile's paused / unasked pane paints notice-warn-ink straight on the
  // dialog's raised-deep ground; Match Cards' outline Keep buttons paint
  // neon-green-text on the same ground. Pinned by name so a palette change
  // that breaks either screen says which one.
  const PAIRS: [TextRole, SurfaceRole][] = [
    ["notice-warn-ink", "raised-deep"],
    ["neon-green-text", "raised-deep"],
  ];
  for (const mode of ["dark", "light"] as const) {
    it(`${mode}: each reads 4.5:1`, () => {
      for (const [fg, bg] of PAIRS) {
        const ratio = contrastRatio(tokenHex(fg, mode), tokenHex(bg, mode));
        expect({ fg, bg, ok: ratio >= 4.5 }).toEqual({ fg, bg, ok: true });
      }
    });
  }
});

describe("the danger notice is neon pink, never red or salmon (NEO-606)", () => {
  // Jason, 2026-11-18: "there shouldn't be any salmon, that is not one of our
  // colors. errors are neon pink." One pink for errors: the ink IS
  // neon-pink-text, so the adversarial sweep below holds it to that role's bars
  // (TEXT_NEVER_ON). This pins that, the pink hue of all three roles, and the
  // ink on its own tinted ground over the page and a card.
  const px = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const over = (fg: string, alpha: number, bg: string) =>
    `#${px(fg)
      .map((c, i) => Math.round(alpha * c + (1 - alpha) * px(bg)[i]).toString(16).padStart(2, "0"))
      .join("")}`;
  /** Hue (degrees) of a `#rrggbb` colour in OKLCH. */
  const oklchHue = (hex: string) => {
    const [r, g, b] = px(hex).map((c) => {
      const x = c / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  };
  const colourIn = (value: string) => /oklch\([^)]*\)|#[0-9a-f]{6}/i.exec(value)?.[0] ?? "";

  for (const [mode, css] of [
    ["dark", dark],
    ["light", light],
  ] as const) {
    it(`${mode}: the ink is neon-pink-text and carries its bars`, () => {
      expect(css["notice-danger-ink"]).toBe("var(--neon-pink-text)");
      expect(tokenHex("notice-danger-ink", mode)).toBe(tokenHex("neon-pink-text", mode));
      expect(TEXT_NEVER_ON[mode]["notice-danger-ink"]).toEqual(TEXT_NEVER_ON[mode]["neon-pink-text"]);
    });

    it(`${mode}: ink, rule and ground are all in the neon pink's hue band`, () => {
      const hexes = [
        tokenHex("notice-danger-ink", mode),
        cssColorToHex(css["notice-danger-rule"]),
        cssColorToHex(colourIn(css["notice-danger-bg"])),
      ];
      for (const hex of hexes) {
        const hue = oklchHue(hex);
        expect({ hex, ok: hue > 340 && hue < 365 }).toEqual({ hex, ok: true });
      }
    });

    // The CardPairingModal error wells sit on `field`; the CardTitlesStep
    // short-name refusal sits on `raised-deep`.
    it(`${mode}: the ink reads 4.5:1 on field and on raised-deep`, () => {
      const ink = tokenHex("notice-danger-ink", mode);
      for (const surface of ["field", "raised-deep"] as SurfaceRole[]) {
        const ratio = contrastRatio(ink, tokenHex(surface, mode));
        expect({ mode, surface, ok: ratio >= 4.5, ratio }).toEqual({ mode, surface, ok: true, ratio });
      }
    });

    it(`${mode}: the ink reads 4.6:1 on its own ground over the page and a card; the rule reaches 3:1 on both`, () => {
      const ink = tokenHex("notice-danger-ink", mode);
      const rule = cssColorToHex(css["notice-danger-rule"]);
      const translucent = css["notice-danger-bg"].startsWith("color-mix");
      const tint = cssColorToHex(colourIn(css["notice-danger-bg"]));
      for (const surface of ["surface", "raised"] as SurfaceRole[]) {
        const under = tokenHex(surface, mode);
        const ground = translucent ? over(tint, 0.3, under) : tint;
        // 4.6, not 4.5: protects the margin (dark over raised measured 4.88).
        expect({ mode, surface, ink: contrastRatio(ink, ground) >= 4.6 }).toEqual({ mode, surface, ink: true });
        expect({ mode, surface, rule: contrastRatio(rule, under) >= 3 }).toEqual({ mode, surface, rule: true });
      }
    });
  }
});

describe("adversarial: every text and ink role, both modes", () => {
  const roles = (re: RegExp) => (Object.keys(TOKENS.dark) as TokenRole[]).filter((r) => re.test(r));
  const TEXT = roles(/(-text|^ink(-[23])?|^notice-.*-ink)$/) as TextRole[];

  for (const mode of ["dark", "light"] as const) {
    // Every surface in both modes. A pair under 4.5:1 must be in TEXT_NEVER_ON
    // (and so is never painted, see the scan below); a listed pair that now
    // passes must come off the list. The table can neither hide a new miss
    // nor go stale.
    it(`${mode}: every *-text and ink role reads 4.5:1 on every surface it may sit on`, () => {
      const misses: string[] = [];
      const stale: string[] = [];
      for (const fg of TEXT) {
        const never = TEXT_NEVER_ON[mode][fg] ?? [];
        for (const bg of SURFACE_ROLES) {
          const ratio = contrastRatio(tokenHex(fg, mode), tokenHex(bg, mode));
          if (ratio < 4.5 && !never.includes(bg)) misses.push(`${fg} on ${bg}: ${ratio.toFixed(2)}`);
          if (ratio >= 4.5 && never.includes(bg)) stale.push(`${fg} on ${bg}: ${ratio.toFixed(2)}`);
        }
      }
      expect({ misses, stale }).toEqual({ misses: [], stale: [] });
    });

    it(`${mode}: every pick-*-ink role reads 4.5:1 on its own fill`, () => {
      const misses: string[] = [];
      for (const ink of roles(/^pick-.*-ink$/)) {
        const fill = ink.replace(/-ink$/, "") as TokenRole;
        const ratio = contrastRatio(tokenHex(ink, mode), tokenHex(fill, mode));
        if (ratio < 4.5) misses.push(`${ink} on ${fill}: ${ratio.toFixed(2)}`);
      }
      expect(misses).toEqual([]);
    });
  }

  it("both modes define exactly the same roles", () => {
    expect(Object.keys(TOKENS.light).sort()).toEqual(Object.keys(TOKENS.dark).sort());
  });
});

/**
 * The other half of TEXT_NEVER_ON: no element paints a listed text role on a
 * listed surface. Reads every class string in app/, components/, src/ and
 * lib/ and works out, per state (at rest, and under each variant such as
 * `hover:` or `disabled:`), which text and which surface that element ends up
 * with. It sees one element's own classes; text inherited from an ancestor
 * is out of its reach, so the table's comment is the rule for that case.
 */
describe("no class string paints text on a surface it fails on", () => {
  const webRoot = join(__dirname, "../..");
  const STATE_VARIANTS = new Set(["hover", "focus", "focus-visible", "focus-within", "active", "disabled", "group-hover", "aria-disabled", "aria-selected", "aria-checked", "aria-pressed"]);
  const RESPONSIVE = new Set(["sm", "md", "lg", "xl", "2xl", "max-sm", "max-md", "max-lg"]);
  // Every text role, not just the listed ones: `text-ink-3 hover:text-ink`
  // must read as ink under the pointer.
  const textRoles = new Set<string>((Object.keys(TOKENS.dark) as TokenRole[]).filter((r) => /(-text|^ink(-[23])?|^notice-.*-ink)$/.test(r)));
  const surfaces = new Set<string>(SURFACE_ROLES);

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(join(webRoot, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) out.push(...sourceFiles(rel));
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(rel);
    }
    return out;
  }

  /** `[state, kind, role]` for each text/bg role token in one class string. */
  function parse(chunk: string) {
    const found: Array<{ state: string; kind: "text" | "bg"; role: string }> = [];
    for (const token of chunk.split(/[\s"'`{}]+/)) {
      const parts = token.split(":");
      const utility = parts.pop()!.replace(/^!/, "").replace(/\/[\w.]+$/, "");
      const variants = parts.filter((v) => !RESPONSIVE.has(v));
      if (variants.length > 1 || (variants.length === 1 && !STATE_VARIANTS.has(variants[0]))) continue;
      const state = variants[0] ?? "";
      const text = /^text-(.+)$/.exec(utility);
      const bg = /^bg-(.+)$/.exec(utility);
      if (text && textRoles.has(text[1])) found.push({ state, kind: "text", role: text[1] });
      if (bg && surfaces.has(bg[1])) found.push({ state, kind: "bg", role: bg[1] });
    }
    return found;
  }

  it("finds none", () => {
    const hits: string[] = [];
    for (const file of ["app", "components", "src", "lib"].flatMap(sourceFiles)) {
      const src = readFileSync(join(webRoot, file), "utf8");
      for (const m of src.matchAll(/"([^"\n]*)"|`([^`]*)`/g)) {
        const tokens = parse(m[1] ?? m[2] ?? "");
        if (!tokens.some((t) => t.kind === "bg") || !tokens.some((t) => t.kind === "text")) continue;
        const states = new Set(["", ...tokens.map((t) => t.state)]);
        for (const state of states) {
          const pick = (kind: "text" | "bg") =>
            tokens.find((t) => t.kind === kind && t.state === state)?.role ??
            tokens.find((t) => t.kind === kind && t.state === "")?.role;
          const fg = pick("text") as TextRole | undefined;
          const bg = pick("bg") as SurfaceRole | undefined;
          if (!fg || !bg) continue;
          for (const mode of ["dark", "light"] as const) {
            if (TEXT_NEVER_ON[mode][fg]?.includes(bg)) {
              hits.push(`${file}: ${state || "rest"} text-${fg} on bg-${bg} (${mode})`);
            }
          }
        }
      }
    }
    expect(hits).toEqual([]);
  });
});

describe("shadow-offset's hairline (Jason, 2026-10-22)", () => {
  const start = themeCss.indexOf("@utility shadow-offset {");
  const utility = themeCss.slice(start, themeCss.indexOf("\n}", start));

  it("draws a 1px inset left and top edge in light, layered with the offset", () => {
    expect(utility).toContain('[data-theme="light"] & {\n    --offset-edge: inset 1px 1px 0 var(--rule-strong);');
    expect(utility).toContain("--tw-shadow: 5px 5px 0 var(--offset-shadow), var(--offset-edge);");
    expect(utility).toContain("--tw-shadow: 5px 5px 0 var(--offset-shadow-complete), var(--offset-edge);");
  });

  it("skips it on a sheet with its own full border", () => {
    expect(utility).toContain('[data-theme="light"] &:is([class~="border"], [class~="border-2"]) {\n    --offset-edge: 0 0 #0000;');
  });

  it("does nothing in dark", () => {
    // Every selector in the utility is scoped to light.
    const selectors = utility.split("\n").filter((l) => /^ {2}\S.*[{,]$/.test(l));
    expect(selectors.length).toBeGreaterThan(0);
    expect(selectors.filter((l) => !l.includes('[data-theme="light"]'))).toEqual([]);
  });
});

/**
 * NEO-645: `TidyNote` paints `text-neon-purple-text` on `bg-neon-purple/10`, and
 * it sits inside the walk's tiles (the panel, a tile's own blue or pink wash, or
 * the plain raised card). axe flagged it in dark at 4.2:1; the role is held to
 * 4.5:1 on every one of those grounds, in both modes.
 */
describe("the purple note reads on every tile ground", () => {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const over = (top: string, alpha: number, ground: string) => {
    const t = rgb(top);
    const g = rgb(ground);
    return `#${t.map((c, i) => Math.round(alpha * c + (1 - alpha) * g[i]).toString(16).padStart(2, "0")).join("")}`;
  };
  const fills = { blue: "#00c2ff", pink: "#ff2e9a" } as const;

  for (const mode of ["dark", "light"] as const) {
    const panel = surfaceHex("raised-deep", mode);
    const grounds: Record<string, string> = {
      "plain tile": surfaceHex("raised", mode),
      "blue tile": mode === "dark" ? over(fills.blue, 0.1, panel) : "#ffffff",
      "pink tile": mode === "dark" ? over(fills.pink, 0.1, panel) : "#ffffff",
    };
    for (const [name, ground] of Object.entries(grounds)) {
      it(`${mode}: on the ${name}`, () => {
        const note = over(tokenHex("neon-purple", mode), 0.1, ground);
        expect(contrastRatio(tokenHex("neon-purple-text", mode), note)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

/**
 * NEO-645: the highlighted row of `EntityLinkSearch`'s results is `bg-neon-green/20`
 * over whatever the search sits on: the panel, or a tile's plain, blue or pink
 * ground (the Player and Team tiles open it inline). The name is
 * `neon-green-text`; the sport badge and the career line beside it are quiet
 * text on that same wash. axe flagged them in dark, where `ink-3` (a hint
 * colour for the plain panel) slips under 4.5:1 on a tinted tile, so the
 * highlighted row paints `ink-2`. Both roles are held to 4.5:1 on every ground
 * the row can have, in both modes.
 */
describe("the player search's highlighted row reads on its green wash", () => {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const over = (top: string, alpha: number, ground: string) => {
    const t = rgb(top);
    const g = rgb(ground);
    return `#${t.map((c, i) => Math.round(alpha * c + (1 - alpha) * g[i]).toString(16).padStart(2, "0")).join("")}`;
  };
  const fills = { blue: "#00c2ff", pink: "#ff2e9a" } as const;

  for (const mode of ["dark", "light"] as const) {
    const panel = surfaceHex("raised-deep", mode);
    const tiles: Record<string, string> = {
      panel,
      "plain tile": surfaceHex("raised", mode),
      "blue tile": mode === "dark" ? over(fills.blue, 0.1, panel) : "#ffffff",
      "pink tile": mode === "dark" ? over(fills.pink, 0.1, panel) : "#ffffff",
    };
    for (const [name, tile] of Object.entries(tiles)) {
      const highlighted = over(tokenHex("neon-green", mode), 0.2, tile);
      it(`${mode}: ink-2 on the highlighted row over the ${name}`, () => {
        expect(contrastRatio(tokenHex("ink-2", mode), highlighted)).toBeGreaterThanOrEqual(4.5);
      });
      it(`${mode}: neon-green-text on the highlighted row over the ${name}`, () => {
        expect(contrastRatio(tokenHex("neon-green-text", mode), highlighted)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
