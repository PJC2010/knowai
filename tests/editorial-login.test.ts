import test from "node:test";
import assert from "node:assert/strict";
import { requestEditorLogin } from "../src/lib/editorial/login";

const email = "editor@example.test";
test("missing editor configuration reports a setup error without contacting Supabase", async () => {
  const events: unknown[] = [];
  const result = await requestEditorLogin(email, {
    allowlist: " , ",
    report: (event) => events.push(event),
    sendLink: async () => {
      throw new Error("Must not send");
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /setup is incomplete/);
  assert.deepEqual(events, [{ reason: "allowlist_missing" }]);
});
test("only allowlisted emails reach Supabase, while public responses keep membership private", async () => {
  const events: unknown[] = [];
  const requests: string[] = [];
  const deps = {
    allowlist: "second@example.test, EDITOR@example.test ",
    report: (event: unknown) => events.push(event),
    sendLink: async (address: string) => {
      requests.push(address);
      return { error: null };
    },
  };
  const skipped = await requestEditorLogin("outsider@example.test", deps);
  const sent = await requestEditorLogin(" EDITOR@example.test ", deps);
  assert.deepEqual(skipped, sent);
  assert.deepEqual(requests, [email]);
  assert.deepEqual(events, [
    { reason: "not_allowlisted" },
    { reason: "provider_accepted" },
  ]);
  assert.doesNotMatch(sent.message, /on its way|email was sent/);
});
test("email restrictions and limits have useful messages without leaking provider details", async () => {
  for (const [code, status, message] of [
    ["email_address_not_authorized", 403, /restricting delivery/],
    ["over_email_send_rate_limit", 429, /Too many/],
    ["otp_disabled", 400, /server logs/],
    ["signup_disabled", 400, /server logs/],
    ["secret@example.test", 500, /server logs/],
  ] as const) {
    const events: unknown[] = [];
    const result = await requestEditorLogin(email, {
      allowlist: email,
      report: (event) => events.push(event),
      sendLink: async () => ({
        error: { code, status, message: "secret-provider-response" },
      }),
    });
    assert.equal(result.ok, false);
    assert.match(result.message, message);
    assert.deepEqual(events, [
      {
        reason: "provider_rejected",
        code: code.includes("@") ? "unknown" : code,
        status,
      },
    ]);
    assert.doesNotMatch(
      JSON.stringify({ events, result }),
      /secret|editor@example/,
    );
  }
});
test("network failures and invalid inputs never claim an email was sent", async () => {
  const events: unknown[] = [];
  let requests = 0;
  const deps = {
    allowlist: email,
    report: (event: unknown) => events.push(event),
    sendLink: async () => {
      requests++;
      throw new Error("sensitive connection info");
    },
  };
  assert.equal((await requestEditorLogin("not an email", deps)).ok, false);
  assert.equal(requests, 0);
  const failed = await requestEditorLogin(email, deps);
  assert.equal(failed.ok, false);
  assert.deepEqual(events, [{ reason: "request_failed" }]);
  assert.doesNotMatch(JSON.stringify({ events, failed }), /sensitive/);
});
