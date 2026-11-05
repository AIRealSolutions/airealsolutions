// Server-only helpers for the group PIN gate. The PIN lives in an httpOnly cookie set by /golf/unlock.
import { cookies } from "next/headers";
import { golfRpc } from "./api";

export const PIN_COOKIE = "golf_pin";
export const PIN_ERROR_COOKIE = "golf_pin_error";

export async function getPin() {
  return (await cookies()).get(PIN_COOKIE)?.value ?? "";
}

export async function getPinError() {
  return (await cookies()).get(PIN_ERROR_COOKIE)?.value ?? "";
}

/** 'admin' | 'group' when the PIN is right, otherwise an error message. */
export async function checkPin(pin: string): Promise<{ role?: "admin" | "group"; error?: string }> {
  if (!pin) return { error: "" };
  try {
    return await golfRpc<{ role?: "admin" | "group"; error?: string }>("golf_check_pin", { p_pin: pin });
  } catch {
    return { error: "Could not check the PIN. Try again in a minute." };
  }
}
