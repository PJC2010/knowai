import { spawn } from "node:child_process";
const env = {
  ...process.env,
  BRIEF_V2_ENABLED: "true",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:4310",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key",
  SUPABASE_SECRET_KEY: "fixture-service-key",
  EDITORIAL_OPENROUTER_API_KEY: "",
  CRON_SECRET: "fixture-cron-secret",
  // Reproduce a deployment URL copied with its trailing slash; the callback
  // and canonical URLs must still match their exact, single-slash paths.
  NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:4311/",
  EDITOR_EMAIL_ALLOWLIST: "editor@example.test",
};
const fixture = spawn("npx", ["tsx", "tests/brief-fixture-server.ts"], {
  env,
  stdio: "inherit",
  detached: true,
});
const run = (command, args) =>
  new Promise((resolve, reject) => {
    const p = spawn(command, args, { env, stdio: "inherit" });
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      const response = await fetch("http://127.0.0.1:4310/health");
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw new Error("Fixture did not start");
  await run("npm", ["run", "build"]);
  await run("npx", [
    "playwright",
    "test",
    "--config=playwright.brief.config.ts",
  ]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  try {
    process.kill(-fixture.pid, "SIGTERM");
  } catch {}
}
