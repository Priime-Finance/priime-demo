import type { Metadata } from "next";
import RackCanvas from "@/components/canvas/RackCanvas";
import { templateById } from "@/lib/canvas/templates";
import "./hm.css";
import "./build.css";

export const metadata: Metadata = {
  title: "Priime Build, compose a vault",
  description: "Compose your own automated vault from verified modules.",
  robots: { index: false },
};

/**
 * /build                   → the recursive loop builder (the canvas)
 * /build?template=<id>     → the canvas preloaded with a registry template
 *                            (lib/canvas/templates.ts); unknown ids fall back
 *                            to the normal empty canvas, never an error.
 */
export default async function BuildPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const template = templateById(typeof sp.template === "string" ? sp.template : "");
  return <RackCanvas templateId={template?.id} />;
}
