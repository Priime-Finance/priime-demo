export function GET() {
  return Response.json(null);
}

export function POST() {
  return new Response(null, { status: 204 });
}
