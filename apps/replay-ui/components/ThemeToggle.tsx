"use client";

/**
 * ThemeToggle — the presenter's register switch, drawn as the kit's
 * `layout/SegmentedTabs` at control size: an aluminium two-segment strip where
 * the live register is the key that is down, with its lamp lit orange.
 *
 * Dark is the default register. The choice is written to `localStorage` and
 * re-applied before first paint by the inline script in `app/layout.tsx`, so
 * a reload never flashes the wrong chassis. There is no system-preference
 * sniffing: a presenter picks a register for a room, not for an OS setting.
 */
import { useEffect, useState } from "react";

/** The two registers. */
export type Theme = "dark" | "light";

/** localStorage key. Shared verbatim with the pre-paint script in layout.tsx. */
export const THEME_STORAGE_KEY = "priime.replay-ui.theme";

/** Read the register the pre-paint script settled on. */
function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

/** The register switch. */
export function ThemeToggle(): React.JSX.Element {
  // The server and the first client render agree on "dark"; the effect below
  // reconciles with whatever the pre-paint script actually applied.
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  const apply = (next: Theme): void => {
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private browsing / storage disabled: the switch still works for the
      // session, it just will not survive a reload.
    }
  };

  return (
    <div className="themesw" role="group" aria-label="Console register" data-testid="theme-switch">
      {(["dark", "light"] as const).map((option) => (
        <button
          key={option}
          type="button"
          className="themesw__opt"
          aria-pressed={theme === option}
          onClick={() => apply(option)}
          data-testid={`theme-${option}`}
        >
          <span className="themesw__lamp" aria-hidden="true" />
          {option}
        </button>
      ))}
    </div>
  );
}
