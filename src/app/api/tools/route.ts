import { parseAndExecuteTurnoTool, turnoToolRequestSchema } from "@/lib/server/turno-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = turnoToolRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, code: "INVALID_REQUEST", message: "The tool request did not match its contract.", recoverable: false }, { status: 400 });
  const result = parseAndExecuteTurnoTool(parsed.data);
  return Response.json(result, { status: result.ok ? 200 : 409 });
}
