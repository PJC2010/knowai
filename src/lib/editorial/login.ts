// No provider messages, addresses, keys, or tokens are written to diagnostics.
// These reason codes are for private server logs, not the public form.
type Diagnostic = {
  reason:
    | "allowlist_missing"
    | "not_allowlisted"
    | "provider_rejected"
    | "request_failed"
    | "provider_accepted";
  code?: string;
  status?: number;
};
type ProviderError = { code?: string; status?: number };
type Dependencies = {
  allowlist: string | undefined;
  sendLink: (email: string) => Promise<{ error: ProviderError | null }>;
  report: (diagnostic: Diagnostic) => void;
};
const accepted = {
  ok: true,
  message:
    "If this address is authorized and already has an editor account, check your inbox and spam folder for a sign-in link. Open it in this browser.",
};
const knownCodes = new Set([
  "email_address_not_authorized",
  "over_email_send_rate_limit",
  "over_request_rate_limit",
  "otp_disabled",
  "signup_disabled",
  "email_provider_disabled",
  "user_not_found",
  "unexpected_failure",
  "email_address_invalid",
  "validation_failed",
  "captcha_failed",
  "request_timeout",
  "hook_timeout",
  "hook_timeout_after_retry",
]);

export async function requestEditorLogin(rawEmail: string, deps: Dependencies) {
  const email = rawEmail.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { ok: false, message: "Enter your editor email address." };
  const allowed = (deps.allowlist || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.length) {
    deps.report({ reason: "allowlist_missing" });
    return {
      ok: false,
      message:
        "Editor sign-in setup is incomplete. The site owner needs to configure editor access.",
    };
  }
  if (!allowed.includes(email)) {
    deps.report({ reason: "not_allowlisted" });
    // Keep account membership private, without claiming that an email was sent.
    return accepted;
  }
  try {
    const { error } = await deps.sendLink(email);
    if (error) {
      const code =
        error.code && knownCodes.has(error.code) ? error.code : "unknown";
      const status =
        Number.isInteger(error.status) &&
        error.status! >= 100 &&
        error.status! <= 599
          ? error.status
          : undefined;
      deps.report({ reason: "provider_rejected", code, status });
      if (
        code === "over_email_send_rate_limit" ||
        code === "over_request_rate_limit" ||
        status === 429
      )
        return {
          ok: false,
          message:
            "Too many sign-in requests. Wait before trying again; the email provider has temporarily limited delivery.",
        };
      if (code === "email_address_not_authorized")
        return {
          ok: false,
          message:
            "The email provider is restricting delivery. The site owner needs to finish the email delivery setup.",
        };
      return {
        ok: false,
        message:
          "Could not send the sign-in link. The site owner can check editor sign-in diagnostics in the server logs.",
      };
    }
    deps.report({ reason: "provider_accepted" });
    // Provider acceptance does not prove delivery to the recipient's mailbox.
    return accepted;
  } catch {
    deps.report({ reason: "request_failed" });
    return {
      ok: false,
      message:
        "The sign-in service could not be reached or is not configured correctly. Try again later.",
    };
  }
}
