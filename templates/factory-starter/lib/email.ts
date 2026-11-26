// Plain-text email through Resend. Server only (RESEND_API_KEY). Returns false when email is not set up.
export async function sendEmail(to: string, subject: string, text: string, replyTo?: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from || !to) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: oneLine(subject), text, ...(replyTo ? { reply_to: oneLine(replyTo) } : {}) }),
  });
  if (!r.ok) console.error("[email] Resend failed", r.status, await r.text().catch(() => ""));
  return r.ok;
}

/** No line breaks in header-like values. */
export const oneLine = (s: string, max = 200) => s.replace(/[\r\n]+/g, " ").trim().slice(0, max);
