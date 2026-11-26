import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const sb = await supabaseServer();
  await sb?.auth.signOut();
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
