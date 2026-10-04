import test from "node:test";
import assert from "node:assert/strict";
import { siteUrl } from "../src/lib/site-url";

test("site origins keep editor callbacks on the configured host with exactly one slash", () => {
  const keys = [
    "NEXT_PUBLIC_SITE_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
    "VERCEL_URL",
  ] as const;
  const previous = keys.map((key) => [key, process.env[key]] as const);
  try {
    for (const key of keys) delete process.env[key];
    assert.equal(siteUrl(), "http://localhost:3000");
    process.env.VERCEL_URL = "preview.example.com";
    assert.equal(siteUrl(), "https://preview.example.com");
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "production.example.com/";
    assert.equal(siteUrl(), "https://production.example.com");
    for (const input of [
      "https://knowai-sepia.vercel.app",
      "https://knowai-sepia.vercel.app/",
      " https://knowai-sepia.vercel.app/// ",
      "https://knowai-sepia.vercel.app/editor?view=drafts#form",
    ]) {
      process.env.NEXT_PUBLIC_SITE_URL = input;
      assert.equal(siteUrl(), "https://knowai-sepia.vercel.app");
      assert.equal(
        new URL("/editor/callback", siteUrl()).toString(),
        "https://knowai-sepia.vercel.app/editor/callback",
      );
    }
    process.env.NEXT_PUBLIC_SITE_URL = "http://127.0.0.1:4311/";
    assert.equal(siteUrl(), "http://127.0.0.1:4311");
    for (const invalid of [
      "javascript:alert(1)",
      "https://user:password@example.com",
      "not-a-url",
    ]) {
      process.env.NEXT_PUBLIC_SITE_URL = invalid;
      assert.throws(() => siteUrl());
    }
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
