"use server";
// Server Actions. They run as the signed-in user, so row-level security still applies.
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";

const STATUSES = new Set(["new", "contacted", "done", "archived"]);

export async function setStatus(fd: FormData) {
  const id = String(fd.get("id") || "");
  const status = String(fd.get("status") || "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !STATUSES.has(status)) return;
  const sb = await supabaseServer();
  if (!sb) return;
  await sb.from("site_submissions").update({ status }).eq("id", id);
  revalidatePath("/", "layout");
}
