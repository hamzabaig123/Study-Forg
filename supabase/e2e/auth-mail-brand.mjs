#!/usr/bin/env node
/**
 * StudyForge auth-mail branding check — reads the live auth config and proves it
 * still matches the templates committed here.
 *
 * Why this exists: `smtp_sender_name` and the two template bodies are dashboard
 * settings, not schema. Nothing in a migration or a unit test can see them, so an
 * edit in the dashboard — or a staging project that never got them — silently
 * returns the mail to Supabase's plain defaults, which is exactly the state this
 * project shipped in until 2026-09-28 ("Study Forg", 184-character confirmation).
 * This is the guard that keeps that from coming back unnoticed.
 *
 * It sends no mail and reads no secret: `GET /config/auth` is the whole request,
 * and a password-shaped key is reported as present/absent only.
 *
 * Credentials (env only, never a file that gets committed):
 *   SUPABASE_ACCESS_TOKEN  dashboard → Account → Advanced → API tokens
 *   SUPABASE_PROJECT_REF   the <ref> from https://<ref>.supabase.co
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... node supabase/e2e/auth-mail-brand.mjs
 *
 * Exit 0 = sender name and both templates match the committed files.
 * Exit 1 = a value moved, or the live HTML is a Supabase default. Exit 2 = the
 * script could not run (missing credential, or the endpoint refused).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const templates = join(root, "supabase", "email-templates");
const API = "https://api.supabase.com/v1";

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const REF = process.env.SUPABASE_PROJECT_REF?.trim();

if (!TOKEN) {
  console.error(
    "SUPABASE_ACCESS_TOKEN is not set.\n" +
      "  Create one at https://supabase.com/dashboard/account/tokens and run:\n" +
      "  SUPABASE_ACCESS_TOKEN=<token> SUPABASE_PROJECT_REF=<ref> node supabase/e2e/auth-mail-brand.mjs",
  );
  process.exitCode = 2;
} else if (!REF) {
  console.error("SUPABASE_PROJECT_REF is not set (the subdomain of https://<ref>.supabase.co).");
  process.exitCode = 2;
}

/**
 * The variables GoTrue substitutes. Any other `{{ … }}` reached the reader's
 * inbox as literal text, so a template that uses one is a failure, not a typo.
 */
const KNOWN_VARIABLES = new Set(["ConfirmationURL", "Email", "NewEmail", "SiteURL"]);

/** The markers that separate a StudyForge mail from Supabase's stock HTML. */
const MARKERS = [
  ["gradient band", /linear-gradient\(135deg,#f59e0b 0%,#ea580c 100%\)/],
  ["wordmark", />StudyForge</],
  ["hidden preheader", /display:none;max-height:0;overflow:hidden/],
  ["single-use advice", /works <strong style="color:#1c1917;">once<\/strong>|single-use/],
];

const CHECKS = [
  {
    key: "smtp_sender_name",
    label: "sender name",
    file: null,
    expect: "StudyForge",
  },
  {
    key: "mailer_templates_confirmation_content",
    label: "confirm-signup template",
    file: "confirm-signup.html",
    expect: null,
  },
  {
    key: "mailer_templates_recovery_content",
    label: "reset-password template",
    file: "reset-password.html",
    expect: null,
  },
];

async function main() {
  if (process.exitCode === 2) return;

  const res = await fetch(`${API}/projects/${REF}/config/auth`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(
      `GET /config/auth -> HTTP ${res.status}. ` +
        "A 401 means the token authenticates nobody; a 404 means the ref is wrong.",
    );
    console.error(`  ${text.slice(0, 200)}`);
    process.exitCode = 2;
    return;
  }
  const config = JSON.parse(text);

  let failed = 0;
  const say = (ok, line) => {
    if (!ok) failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${line}`);
  };

  for (const check of CHECKS) {
    const live = config[check.key];
    if (typeof live !== "string" || live.length === 0) {
      say(false, `${check.label}: config key ${check.key} came back empty`);
      continue;
    }

    if (check.file === null) {
      say(live === check.expect, `sender name is ${JSON.stringify(live)} (want ${JSON.stringify(check.expect)})`);
      continue;
    }

    // Compared with the template's own line endings, because the API normalises
    // CRLF on the way in and an exact-byte compare would fail on every platform.
    const committed = readFileSync(join(templates, check.file), "utf8").replace(/\r\n/g, "\n");
    const normalised = live.replace(/\r\n/g, "\n");
    say(normalised === committed, `${check.label}: live HTML is byte-identical to supabase/email-templates/${check.file} (${committed.length} chars)`);

    const defaults = /^<h2>/m.test(normalised) && !/<html/i.test(normalised);
    say(!defaults, `${check.label}: not Supabase's plain default body`);

    for (const [name, pattern] of MARKERS) {
      say(pattern.test(normalised), `${check.label}: ${name} present`);
    }

    const unknown = [...normalised.matchAll(/\{\{\s*\.(\w+)\s*\}\}/g)]
      .map((match) => match[1])
      .filter((name) => !KNOWN_VARIABLES.has(name));
    say(unknown.length === 0, `${check.label}: only GoTrue-known variables${unknown.length ? ` — found ${unknown.join(", ")}` : ""}`);

    const urls = [...normalised.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
    say(urls.length >= 2 && urls.every((href) => href.startsWith("{{ .")), `${check.label}: every link is the GoTrue-built action URL, never a hand-written one`);
  }

  const notification = config.mailer_notifications_password_changed_enabled;
  console.log(`\n  hijack mail on: ${notification === true ? "yes" : JSON.stringify(notification)} (its body is Supabase's default on purpose)`);
  console.log(`  site_url: ${JSON.stringify(config.site_url)} — the link host the templates inherit`);

  if (failed) {
    console.error(`\n${failed} check(s) failed. Patch it with one field per PATCH:`);
    console.error(
      "  PATCH /v1/projects/<ref>/config/auth  {\"smtp_sender_name\": \"StudyForge\"}\n" +
        "  … and the same, once per template, for mailer_templates_confirmation_content\n" +
        "  and mailer_templates_recovery_content, read from the files in that directory.\n" +
        "  One field per request: a rejected key rolls the whole body back.",
    );
    process.exitCode = 1;
    return;
  }
  console.log("\nEvery branding check passed — the mail the project sends is the mail committed here.");
  process.exitCode = 0;
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
});
