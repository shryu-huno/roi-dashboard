export function isAllowedEmail(
  email: string | null | undefined,
  domain: string,
): boolean {
  if (!email) return false;
  const parts = email.toLowerCase().split("@");
  if (parts.length !== 2) return false;
  return parts[1] === domain.toLowerCase();
}
