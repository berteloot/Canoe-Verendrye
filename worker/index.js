// Comments form handler for canoe-verendrye.berteloot.org
//
// Receives POST from tracking.html#comments, verifies the Cloudflare Turnstile
// token, then emails the message to stan@berteloot.org via Resend.
//
// If the optional `garmin_code` field matches GARMIN_PASSWORD, also forwards
// a short message to GARMIN_INREACH_EMAIL so it arrives on the inReach device.
//
// Bindings expected (via wrangler.toml [vars] / secrets):
//   TURNSTILE_SECRET     Turnstile secret key (set as secret)
//   RESEND_API_KEY       Resend API key (set as secret)
//   MAIL_TO              stan@berteloot.org
//   MAIL_FROM            e.g. "Canoe Comments <comments@berteloot.org>"
//   ALLOWED_ORIGIN       https://canoe-verendrye.berteloot.org
//   GARMIN_PASSWORD      Secret code that unlocks Garmin forwarding (set as secret)
//   GARMIN_INREACH_EMAIL Garmin inReach message email address (set as secret)

const TURNSTILE_VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const RESEND_SEND = "https://api.resend.com/emails";
const GARMIN_DELAY_MS = 400; // artificial delay on every password attempt

// Timing-safe string comparison via HMAC to prevent timing attacks.
async function safeMatch(a, b) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const [sigA, sigB] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(a)),
    crypto.subtle.sign("HMAC", key, enc.encode(b)),
  ]);
  const ua = new Uint8Array(sigA), ub = new Uint8Array(sigB);
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
  return diff === 0;
}

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function jsonResponse(body, status, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, env);
    }

    // Parse body (accept JSON or form-encoded)
    let payload = {};
    const ct = request.headers.get("content-type") || "";
    try {
      if (ct.includes("application/json")) {
        payload = await request.json();
      } else {
        const form = await request.formData();
        for (const [k, v] of form.entries()) payload[k] = v;
      }
    } catch {
      return jsonResponse({ ok: false, error: "bad_request" }, 400, env);
    }

    // Honeypot
    if (payload["bot-field"]) {
      return jsonResponse({ ok: true }, 200, env); // silently accept
    }

    const name = (payload.name || "").toString().trim();
    const message = (payload.message || "").toString().trim();
    const token = (payload["cf-turnstile-response"] || "").toString();
    const garminCode = (payload["garmin_code"] || "").toString().trim();

    if (!name || name.length > 60) {
      return jsonResponse({ ok: false, error: "invalid_name" }, 400, env);
    }
    if (!message || message.length > 800) {
      return jsonResponse({ ok: false, error: "invalid_message" }, 400, env);
    }
    if (!token) {
      return jsonResponse({ ok: false, error: "missing_captcha" }, 400, env);
    }

    // Verify Turnstile
    const ip = request.headers.get("CF-Connecting-IP") || "";
    const verifyBody = new URLSearchParams({
      secret: env.TURNSTILE_SECRET,
      response: token,
      remoteip: ip,
    });
    const verifyRes = await fetch(TURNSTILE_VERIFY, {
      method: "POST",
      body: verifyBody,
    });
    const verifyJson = await verifyRes.json().catch(() => ({}));
    if (!verifyJson.success) {
      return jsonResponse(
        { ok: false, error: "captcha_failed", details: verifyJson["error-codes"] || [] },
        403,
        env,
      );
    }

    // Send email via Resend
    const ua = request.headers.get("User-Agent") || "";
    const country = request.cf?.country || "??";
    const subject = `Canoe note from ${name}`;
    const text =
      `From: ${name}\n` +
      `IP: ${ip} (${country})\n` +
      `UA: ${ua}\n\n` +
      `${message}\n`;
    const html =
      `<p><strong>From:</strong> ${escapeHtml(name)}<br>` +
      `<strong>IP:</strong> ${escapeHtml(ip)} (${escapeHtml(country)})<br>` +
      `<strong>UA:</strong> ${escapeHtml(ua)}</p>` +
      `<p style="white-space:pre-wrap;">${escapeHtml(message)}</p>`;

    const sendRes = await fetch(RESEND_SEND, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: env.MAIL_TO,
        reply_to: env.MAIL_TO,
        subject,
        text,
        html,
      }),
    });

    if (!sendRes.ok) {
      const errText = await sendRes.text().catch(() => "");
      console.log("resend error", sendRes.status, errText);
      return jsonResponse({ ok: false, error: "send_failed" }, 502, env);
    }

    // If the correct code was supplied, forward a short message to the inReach.
    let garminSent = false;
    const garminPassword = (env.GARMIN_PASSWORD || "").trim();
    const garminEmail = (env.GARMIN_INREACH_EMAIL || "").trim();
    // Always delay when a code was submitted — prevents timing-based enumeration.
    if (garminCode) await new Promise(r => setTimeout(r, GARMIN_DELAY_MS));
    const codeCorrect = garminCode && garminPassword && garminEmail &&
      await safeMatch(garminCode, garminPassword);
    if (codeCorrect) {
      const prefix = `${name}: `;
      const maxBody = 160 - prefix.length;
      const garminBody = prefix + message.slice(0, maxBody > 0 ? maxBody : 0);
      const garminRes = await fetch(RESEND_SEND, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: env.MAIL_FROM,
          to: garminEmail,
          subject: garminBody,
          text: garminBody,
        }),
      });
      garminSent = garminRes.ok;
      if (!garminRes.ok) {
        console.log("garmin forward error", garminRes.status, await garminRes.text().catch(() => ""));
      }
    }

    return jsonResponse({ ok: true, garmin: garminSent }, 200, env);
  },
};
