// INTENTIONAL 404: the client falls back to the offline mock quote
// (lib/canvas/mock-quote.ts) and prices the canvas client-side.
export function POST() {
  return new Response(null, { status: 404 });
}
