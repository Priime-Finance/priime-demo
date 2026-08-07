/**
 * Canvas geometry.
 *
 * The diagram is hand-placed, so the useful assertions are the ones a careless
 * coordinate edit would break: every node wired to every node it should be,
 * nothing routed outside the viewBox, and a pulse that actually walks its wire
 * end to end.
 */
import { describe, expect, it } from "vitest";

import {
  attachPoint,
  buildCanvasLayout,
  pointAtProgress,
  polylineLength,
  polylinePath,
  type CanvasMode,
  type CanvasNode,
} from "@/lib/canvas";

const IDS = ["0xaaa", "0xbbb", "0xccc"] as const;
const MODES: readonly CanvasMode[] = ["wide", "tall"];

describe("polyline maths", () => {
  const line = [
    { x: 0, y: 0 },
    { x: 30, y: 40 },
    { x: 30, y: 140 },
  ];

  it("measures a multi-segment route", () => {
    expect(polylineLength(line)).toBe(150);
    expect(polylineLength([])).toBe(0);
    expect(polylineLength([{ x: 5, y: 5 }])).toBe(0);
  });

  it("walks the route from end to end", () => {
    expect(pointAtProgress(line, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAtProgress(line, 1)).toEqual({ x: 30, y: 140 });
    expect(pointAtProgress(line, 50 / 150)).toEqual({ x: 30, y: 40 });
    expect(pointAtProgress(line, 100 / 150)).toEqual({ x: 30, y: 90 });
  });

  it("clamps out-of-range and non-finite progress rather than flying off", () => {
    expect(pointAtProgress(line, -3)).toEqual({ x: 0, y: 0 });
    expect(pointAtProgress(line, 9)).toEqual({ x: 30, y: 140 });
    expect(pointAtProgress(line, Number.NaN)).toEqual({ x: 0, y: 0 });
    expect(pointAtProgress([], 0.5)).toEqual({ x: 0, y: 0 });
  });

  it("renders an SVG path", () => {
    expect(polylinePath(line)).toBe("M 0 0 L 30 40 L 30 140");
    expect(polylinePath([])).toBe("");
  });
});

describe("attachPoint", () => {
  const circle: CanvasNode = {
    id: "vault",
    kind: "vault",
    center: { x: 100, y: 100 },
    width: 40,
    height: 40,
  };
  const plate: CanvasNode = {
    id: "node",
    kind: "operator",
    center: { x: 0, y: 0 },
    width: 100,
    height: 40,
  };

  it("leaves a circle on its radius plus the standoff", () => {
    expect(attachPoint(circle, { x: 200, y: 100 }, 5)).toEqual({ x: 125, y: 100 });
    expect(attachPoint(circle, { x: 100, y: 0 }, 0)).toEqual({ x: 100, y: 80 });
  });

  it("leaves a plate on whichever edge the ray reaches first", () => {
    expect(attachPoint(plate, { x: 500, y: 0 }, 0)).toEqual({ x: 50, y: 0 });
    expect(attachPoint(plate, { x: 0, y: -500 }, 0)).toEqual({ x: 0, y: -20 });
  });

  it("degenerates safely when asked to point at itself", () => {
    expect(attachPoint(plate, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe("buildCanvasLayout", () => {
  it("places one vault, three operators and one chain node in both registers", () => {
    for (const mode of MODES) {
      const layout = buildCanvasLayout(mode, IDS);
      expect(layout.mode).toBe(mode);
      expect(layout.vault.kind).toBe("vault");
      expect(layout.chain.kind).toBe("chain");
      expect(layout.operators.map((node) => node.id)).toEqual([...IDS]);
    }
  });

  it("wires every operator to the vault and to the chain, plus a full mesh", () => {
    for (const mode of MODES) {
      const layout = buildCanvasLayout(mode, IDS);
      const ids = new Set(layout.edges.map((edge) => edge.id));
      for (const id of IDS) {
        expect(ids.has(`read:${id}`)).toBe(true);
        expect(ids.has(`submit:${id}`)).toBe(true);
      }
      expect(layout.edges.filter((edge) => edge.kind === "mesh")).toHaveLength(3);
      expect(layout.edges.filter((edge) => edge.kind === "read")).toHaveLength(3);
      expect(layout.edges.filter((edge) => edge.kind === "submit")).toHaveLength(3);
    }
  });

  it("keeps every routed point inside the viewBox", () => {
    for (const mode of MODES) {
      const layout = buildCanvasLayout(mode, IDS);
      for (const edge of layout.edges) {
        for (const point of edge.points) {
          expect(point.x).toBeGreaterThanOrEqual(0);
          expect(point.y).toBeGreaterThanOrEqual(0);
          expect(point.x).toBeLessThanOrEqual(layout.viewWidth);
          expect(point.y).toBeLessThanOrEqual(layout.viewHeight);
        }
      }
    }
  });

  it("keeps every plate inside the viewBox", () => {
    for (const mode of MODES) {
      const layout = buildCanvasLayout(mode, IDS);
      for (const node of [layout.vault, ...layout.operators, layout.chain]) {
        expect(node.center.x - node.width / 2).toBeGreaterThanOrEqual(0);
        expect(node.center.y - node.height / 2).toBeGreaterThanOrEqual(0);
        expect(node.center.x + node.width / 2).toBeLessThanOrEqual(layout.viewWidth);
        expect(node.center.y + node.height / 2).toBeLessThanOrEqual(layout.viewHeight);
      }
    }
  });

  it("gives every edge a walkable route", () => {
    for (const mode of MODES) {
      const layout = buildCanvasLayout(mode, IDS);
      for (const edge of layout.edges) {
        expect(edge.points.length).toBeGreaterThanOrEqual(2);
        expect(polylineLength(edge.points)).toBeGreaterThan(0);
        expect(pointAtProgress(edge.points, 0)).toEqual(edge.points[0]);
        expect(pointAtProgress(edge.points, 1)).toEqual(edge.points[edge.points.length - 1]);
      }
    }
  });

  it("routes reads out of the vault and submissions into the chain", () => {
    for (const mode of MODES) {
      const layout = buildCanvasLayout(mode, IDS);
      for (const edge of layout.edges) {
        if (edge.kind === "read") expect(edge.from).toBe("vault");
        if (edge.kind === "submit") expect(edge.to).toBe("chain");
      }
    }
  });

  it("falls back to positional ids when the registry is short", () => {
    const layout = buildCanvasLayout("wide", []);
    expect(layout.operators.map((node) => node.id)).toEqual(["node-1", "node-2", "node-3"]);
  });
});
