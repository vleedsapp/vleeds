/** Two-letter avatar initials from an email's local part ("jane.doe@x" → "JD", "owner@x" → "OW"). */
export function initialsFromEmail(email: string | null | undefined): string {
  const local = (email ?? "").split("@")[0] ?? "";
  const parts = local.split(/[._\-+]+/).filter((p) => /[a-z0-9]/i.test(p));
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const word = parts[0] ?? "";
  return (word.slice(0, 2) || "?").toUpperCase();
}
