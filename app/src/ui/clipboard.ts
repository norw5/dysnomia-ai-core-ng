/**
 * Clipboard helper (session-79): `navigator.clipboard` is unavailable outside
 * secure contexts (a plain-http LAN serve is exactly where the owner debugged
 * the Studio), so every copy affordance falls back to a hidden textarea +
 * execCommand("copy") and reports whether the text actually reached the
 * clipboard. No silent success.
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* insecure context / permission denied — fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
