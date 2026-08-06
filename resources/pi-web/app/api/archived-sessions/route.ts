import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const ARCHIVE_FILE = path.join(os.homedir(), ".pi", "agent", "archived-sessions.json");

function readArchive(): string[] {
  try {
    const raw = fs.readFileSync(ARCHIVE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x: unknown) => typeof x === "string");
  } catch { /* file doesn't exist or is corrupt */ }
  return [];
}

export async function GET() {
  return NextResponse.json({ ids: readArchive() });
}

export async function PUT(req: Request) {
  const body = await req.json();
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
  try {
    fs.mkdirSync(path.dirname(ARCHIVE_FILE), { recursive: true });
    fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(ids, null, 2));
  } catch { /* ignore write errors */ }
  return NextResponse.json({ ok: true });
}
