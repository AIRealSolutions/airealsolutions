export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
/** The site still renders without a database; forms and sign-in then say they are not connected yet. */
export const hasSupabase = () => Boolean(SUPABASE_URL && SUPABASE_KEY);
