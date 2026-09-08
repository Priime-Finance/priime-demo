"use client";

/* Ported from build.priime.finance eb6d33a (docs/plans/LATEST_UI_PORT_SPEC.md WP4). */
/**
 * Sticky section tabs for the vault page — the main panel's fixed header
 * (founder chrome call, 2026-08-20): sentence-case sans links with a blue
 * underline, pinned under the floating pill nav, painted on the panel's
 * warm-white ground. While the page is scrolled, a fixed full-bleed cream
 * band (::before, vaults.css) covers the nav clearance to the viewport top
 * so no content is ever readable behind the pill nav or between the nav
 * and the strip; when the strip pins, its own opaque ground + bottom
 * hairline complete the chrome down to y = strip bottom.
 *
 * The active state tracks scroll position: an IntersectionObserver on the
 * sections triggers re-evaluation, and the picker chooses the last section
 * whose top sits above the tracking line, so tall sections hold their tab
 * while they occupy the viewport. Clicking a tab scrolls to the anchor
 * (smooth, with an instant reduced-motion fallback) and pins the clicked
 * tab until the scroll settles so the underline never flickers en route.
 */

import { useEffect, useRef, useState } from "react";

export interface TabSection {
  id: string;
  label: string;
}

const TRACK_LINE_PX = 150;
/** The strip's sticky offset — the pill nav's clearance band. */
const NAV_CLEARANCE_PX = 64;

export default function SectionTabs({ sections }: { sections: TabSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  const [scrolled, setScrolled] = useState(false);
  const [stuck, setStuck] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const clickLockUntil = useRef(0);

  useEffect(() => {
    const els = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const pick = () => {
      if (Date.now() < clickLockUntil.current) return;
      let cur = els[0].id;
      for (const el of els) {
        if (el.getBoundingClientRect().top <= TRACK_LINE_PX + 1) cur = el.id;
      }
      setActive(cur);
    };
    const io = new IntersectionObserver(pick, {
      rootMargin: `-${TRACK_LINE_PX}px 0px -40% 0px`,
      threshold: [0, 0.25, 0.5, 0.75, 1],
    });
    els.forEach((el) => io.observe(el));
    window.addEventListener("scroll", pick, { passive: true });
    pick();
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", pick);
    };
  }, [sections]);

  // Chrome state runs on its own listener (never behind the click lock):
  // `scrolled` arms the fixed cream band over the nav clearance, `stuck`
  // squares the strip's top corners while it is pinned.
  useEffect(() => {
    const onScroll = () => {
      const el = navRef.current;
      setScrolled((p) => (window.scrollY > 2) !== p ? window.scrollY > 2 : p);
      if (el) {
        const s = el.getBoundingClientRect().top <= NAV_CLEARANCE_PX + 0.5;
        setStuck((p) => (s !== p ? s : p));
      }
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const go = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setActive(id);
    clickLockUntil.current = Date.now() + (reduce ? 150 : 750);
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
  };

  return (
    <nav
      ref={navRef}
      className={`vxd-tabs${scrolled ? " vxd-tabs--scrolled" : ""}${stuck ? " vxd-tabs--stuck" : ""}`}
      aria-label="Vault sections"
    >
      <div className="vxd-tabs-scroll">
        {sections.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className={`vxd-tab${active === s.id ? " on" : ""}`}
            aria-current={active === s.id ? "true" : undefined}
            onClick={go(s.id)}
          >
            {s.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
