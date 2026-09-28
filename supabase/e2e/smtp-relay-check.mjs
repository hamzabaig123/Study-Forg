/**
 * StudyForge SMTP relay check — talks to the mail relay the way GoTrue does and
 * prints the reply lines GoTrue keeps to itself.
 *
 * Why this exists: `/auth/v1/recover` answers a refused send with the anonymous
 * `unexpected_failure`, and the provider's real `535`/`553`/`550` line only
 * appears in the project's auth logs. This script gets that line from the other
 * direction — it runs the same conversation against the relay directly, from
 * here, and stops before any message exists.
 *
 * It never sends mail. The conversation ends after `RCPT TO`, so nothing is
 * queued, nothing is delivered, and no daily quota is spent. It authenticates
 * as you, so run it against your own relay account.
 *
 * Credentials come from the environment and are never printed, not even
 * base64-encoded (the AUTH payload is reversible). Put them in a file git
 * ignores and source it, rather than typing them into a shell history or a chat
 * window:
 *
 *   SMTP_USER=<the address you sign into Brevo with>
 *   SMTP_PASS=<the SMTP key, not the API key>
 *   SMTP_FROM=<a sender you verified at Brevo>
 *
 *   set -a; . supabase/.env; set +a
 *   node supabase/e2e/smtp-relay-check.mjs
 *
 * Options: `SMTP_HOST` (default `smtp-relay.brevo.com`), `SMTP_PORT` (default
 * 587 — plain connect then STARTTLS, which is what that port expects),
 * `SMTP_TLS=1` for implicit TLS as used by 465, `SMTP_RCPT` (default
 * `demo@studyforge.test`, a domain reserved for exactly this kind of test),
 * `SMTP_TIMEOUT_MS` (default 25000 for the whole conversation).
 *
 * Exit 0 = the relay authenticated you AND accepted the sender address, which
 * is the whole of what Supabase's SMTP panel can get wrong. A destination
 * refused after that is the address's problem, not the configuration's.
 * Exit 1 = refused, with the failing verb named. Exit 2 = missing input.
 */
import net from "node:net";
import tls from "node:tls";

const HOST = process.env.SMTP_HOST ?? "smtp-relay.brevo.com";
const PORT = Number(process.env.SMTP_PORT ?? 587);
const IMPLICIT_TLS = process.env.SMTP_TLS === "1";
const USER = process.env.SMTP_USER ?? "";
const PASS = process.env.SMTP_PASS ?? "";
const FROM = process.env.SMTP_FROM ?? USER;
const RCPT = process.env.SMTP_RCPT ?? "demo@studyforge.test";
const DEADLINE_MS = Number(process.env.SMTP_TIMEOUT_MS ?? 25_000);

if (!USER || !PASS || !FROM) {
  console.error(
    "SMTP_USER, SMTP_PASS and SMTP_FROM are required (see the header of this file).\n" +
      "Nothing was sent.",
  );
  process.exitCode = 2;
}

const REPLY_LINE = /^(\d{3})([ -])(.*)$/;

/**
 * One SMTP conversation over a socket that may turn into TLS partway through.
 * Replies are read as complete units — a `250-` line is one reply still open,
 * the `250 ` line ends it — because the capability list, and therefore the
 * STARTTLS offer, arrives as several lines in one packet.
 */
class Conversation {
  constructor(socket, started = Date.now()) {
    this.socket = socket;
    this.started = started;
    this.buffer = "";
    this.waiting = [];
    socket.setEncoding("latin1");
    socket.on("data", (chunk) => {
      this.buffer += chunk;
      this.#drain();
    });
  }

  /** Stop reacting to this socket, which is what an upgrade to TLS needs. */
  detach() {
    this.socket.removeAllListeners("data");
    this.buffer = "";
    for (const pending of this.waiting) pending.reject(new Error("connection upgraded"));
    this.waiting = [];
  }

  #drain() {
    while (this.waiting.length && this.#takeReply()) {
      // Each #takeReply() resolves the oldest waiter itself.
    }
  }

  #takeReply() {
    const waiter = this.waiting[0];
    if (!waiter) return false;
    const lines = this.buffer.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const match = REPLY_LINE.exec(lines[i]);
      if (!match) continue;
      if (match[2] === "-") continue;
      this.buffer = lines.slice(i + 1).join("\r\n");
      const text = lines
        .slice(0, i + 1)
        .map((line) => line.replace(/^\d{3}[ -]/, "").trim())
        .filter((part) => part !== "")
        .join(" | ");
      this.waiting.shift();
      waiter.resolve({ code: Number(match[1]), text });
      return true;
    }
    return false;
  }

  reply(label) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waiting.indexOf(pending);
        if (index !== -1) this.waiting.splice(index, 1);
        reject(new Error(`no reply to ${label} after ${Date.now() - this.started} ms`));
      }, DEADLINE_MS);
      const pending = {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      };
      this.waiting.push(pending);
      this.#takeReply();
    });
  }

  async send(line) {
    await new Promise((resolve, reject) => {
      this.socket.write(`${line}\r\n`, (error) => (error ? reject(error) : resolve()));
    });
  }

  /** Say one thing, read the whole reply, and log the exchange as it happens. */
  async cmd(line, label, { secret = false } = {}) {
    console.log(`  → ${secret ? "[credentials, withheld]" : line}   +${Date.now() - this.started} ms`);
    await this.send(line);
    return this.reply(label);
  }
}

function show(reply) {
  console.log(`  ← ${reply.code} ${reply.text}`);
}

const CREDENTIALS = /535|authentication|invalid (api key|credentials)|username|password|\blogin\b/i;
const QUOTA = /\b452\b|quota|capacity|too many|limit exceeded|daily/i;
const SENDER = /550|553|554|sender|from address|not (verified|allowed|permitted|authori[sz]ed)|unverified|does not belong/i;

/** Name the field, from the reply line the relay actually gave. */
function advise(reply, step) {
  // The reply code is stripped out of `text`, and it is often the only thing
  // that identifies the class (a bare `554 Relay access denied` says "sender"
  // only through its number), so classify the code and the words together.
  const haystack = `${reply.code} ${reply.text}`;
  if (CREDENTIALS.test(haystack)) {
    return (
      `Refused at ${step} on credentials, in the relay's own words above. The\n` +
      "  value Supabase needs is Brevo → SMTP & API → *SMTP key*. The API key is a\n" +
      "  different string and answers exactly this way; so does using the API's\n" +
      "  login rather than the address you sign into the account with."
    );
  }
  if (QUOTA.test(haystack)) {
    return (
      `Refused at ${step} for capacity, in the relay's own words above — which is\n` +
      "  the good kind of bad news: the credentials and the sender already passed,\n" +
      "  so the settings are right and the free tier is simply spent. Brevo's free\n" +
      "  allowance is a fixed number of messages a day and it resets at midnight\n" +
      "  UTC; nothing in Supabase needs changing."
    );
  }
  if (SENDER.test(haystack)) {
    return (
      `Refused at ${step} on the sender, in the relay's own words above. Brevo\n` +
      "  accepts a From it has verified: Brevo → Senders & Domains must show that\n" +
      "  domain (or that single address) as verified, with the SPF and DKIM\n" +
      `  records live at the registrar. Tested here as <${FROM}>.`
    );
  }
  return `Refused at ${step}. That reply line is the provider's own, and it is\n` +
    "  the thing GoTrue never shows you — read it, then fix that field.";
}

async function plainSocket() {
  const socket = net.connect({ host: HOST, port: PORT });
  await once(socket, "connect", `no TCP answer from ${HOST}:${PORT}`);
  return socket;
}

async function tlsSocket(socket) {
  const secure = tls.connect(socket ? { socket, servername: HOST } : { host: HOST, port: PORT, servername: HOST });
  await once(secure, "secureConnect", `TLS handshake to ${HOST}:${PORT} did not complete`);
  return secure;
}

function once(target, event, failure) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      target.removeAllListeners();
      reject(new Error(failure));
    }, DEADLINE_MS);
    target.once(event, () => {
      clearTimeout(timeout);
      resolve();
    });
    target.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function main() {
  if (process.exitCode === 2) return;
  console.log(
    `Relay  ${HOST}:${PORT}${IMPLICIT_TLS ? " implicit TLS" : " STARTTLS"}\n` +
      `From   ${FROM}\n` +
      `Rcpt   ${RCPT}    (nothing is sent: the conversation stops before DATA)\n`,
  );

  let socket;
  let conversation;
  try {
    socket = IMPLICIT_TLS ? await tlsSocket(null) : await plainSocket();
    conversation = new Conversation(socket);
  } catch (error) {
    fail(
      `Could not establish the connection: ${error.message}\n\n` +
        "  A port that never answers is the pairing, not the key: 587 is STARTTLS,\n" +
        "  465 is implicit TLS (run this with SMTP_TLS=1), and 2465 drops packets\n" +
        "  on this network. Supabase's port and encryption toggle have to match the\n" +
        "  mode that just worked here.",
    );
    return;
  }

  try {
    const greeting = await conversation.reply("greeting");
    show(greeting);
    if (greeting.code !== 220) return fail("The relay did not greet us. Nothing was sent.");

    const hello = await conversation.cmd("EHLO studyforge-check.local", "EHLO");
    show(hello);
    if (hello.code !== 250) return fail(advise(hello, "EHLO"));

    if (!IMPLICIT_TLS) {
      if (!/STARTTLS/i.test(hello.text)) {
        return fail(
          "This relay does not offer STARTTLS, so this port is not the one GoTrue\n" +
            "  should dial it on. Try SMTP_TLS=1 with port 465.",
        );
      }
      const start = await conversation.cmd("STARTTLS", "STARTTLS");
      show(start);
      if (start.code !== 220) return fail(advise(start, "STARTTLS"));
      conversation.detach();
      socket = await tlsSocket(socket);
      conversation = new Conversation(socket, conversation.started);
      const resumed = await conversation.cmd("EHLO studyforge-check.local", "EHLO after TLS");
      show(resumed);
      if (resumed.code !== 250) return fail(advise(resumed, "EHLO after TLS"));
      console.log(`  ← encrypted session up in ${Date.now() - conversation.started} ms`);
    }

    const offer = await conversation.cmd("AUTH LOGIN", "AUTH LOGIN");
    show(offer);
    if (offer.code !== 334) return fail(advise(offer, "AUTH LOGIN"));

    await conversation.send(Buffer.from(USER, "utf8").toString("base64"));
    const asked = await conversation.reply("username");
    show(asked);
    if (asked.code !== 334) return fail(advise(asked, "AUTH LOGIN (username)"));

    await conversation.send(Buffer.from(PASS, "utf8").toString("base64"));
    const keyed = await conversation.reply("password");
    console.log("  → [credentials, withheld]");
    show(keyed);
    if (keyed.code !== 235) return fail(advise(keyed, "AUTH LOGIN"));
    console.log("  = authenticated: the key and the username are right");

    const from = await conversation.cmd(`MAIL FROM:<${FROM}>`, "MAIL FROM");
    show(from);
    if (from.code !== 250) return fail(advise(from, "MAIL FROM"));
    console.log("  = sender accepted: Brevo knows this address and lets it send");

    const to = await conversation.cmd(`RCPT TO:<${RCPT}>`, "RCPT TO");
    show(to);
    const quit = await conversation.cmd("QUIT", "QUIT").catch(() => null);
    if (quit) show(quit);
    socket.end();

    if (to.code === 250) {
      console.log(
        "\nEvery one of these passed: the connection mode, the credentials, and\n" +
          "  the sender. Nothing was sent, so no quota moved. Supabase's SMTP panel\n" +
          "  holds these same values, so GoTrue should get this far too — if the\n" +
          "  recovery request still answers 500, what the dashboard holds is not\n" +
          "  what was tested here: a trailing space, a stale key, another port.",
      );
      process.exitCode = 0;
      return;
    }
    console.log(
      `\nConfiguration proven: authenticated, TLS fine, sender accepted. Only the\n` +
        `  destination was refused (${to.code})` +
        (/\.(test|invalid|example)$/.test(RCPT) ? ", expected for a reserved domain" : "") +
        ",\n  which is the address's problem and not the mailer's. Put these four\n" +
        "  values into Supabase's SMTP panel and auth mail will go out.",
    );
    process.exitCode = 0;
  } catch (error) {
    fail(`The conversation broke: ${error.message}`);
  } finally {
    socket.destroy();
  }
}

function fail(message) {
  console.error(`\n${message}`);
  process.exitCode = 1;
}

main().catch((error) => fail(error.message));
