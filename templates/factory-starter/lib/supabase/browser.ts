"use client";
import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_KEY, SUPABASE_URL, hasSupabase } from "./env";

export const supabaseBrowser = () => (hasSupabase() ? createBrowserClient(SUPABASE_URL, SUPABASE_KEY) : null);
