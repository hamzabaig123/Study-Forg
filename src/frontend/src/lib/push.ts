/**
 * Web push, the browser half.
 *
 * The daily digest normally arrives by email, but a push notification is
 * instant and free, and it reaches a desktop whose app window has been closed
 * for hours. This module asks for permission, registers the service worker,
 * and stores the resulting subscription in `push_subscriptions` so the
 * reminder-sender Edge Function can find it at send time — push first, email
 * as the safety net.
 *
 * Every call here is reached through a dynamic import from the settings
 * screen, the same seam `lib/supabase/reminders.ts` uses: statically importing
 * the Supabase client would drag `@supabase/supabase-js` into the bundle the
 * mock and canister modes ship.
 *
 * The VAPID public key is public by design — the browser needs it to encrypt
 * its subscription to this server. Its private half lives only in the Edge
 * Function's secrets.
 */

/** The server's VAPID public key (65-byte uncompressed P-256, base64url). */
const VAPID_PUBLIC_KEY =
  "BNIgjff3xlILMaycL5dNWC984tdjiuHqn-orpqIoAMOLzX1-_mlHpjjNITxxmVr2UClQ4Mpm4eei7uRfyBR2KVk";

export interface PushState {
  enabled: boolean;
  supported: boolean;
  detail: string;
}

/** Feature checks, kept dependency-free so the settings screen can call it
 * before the dynamic import even happens. */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// No explicit return annotation: the caller hands this to `applicationServerKey`,
// which wants an ArrayBuffer-backed array, and only inference keeps that.
function urlBase64ToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

/** Whether this browser already carries a subscription for this account. */
export async function pushEnabled(): Promise<boolean> {
  return (await currentSubscription()) !== null;
}

/** Ask, subscribe, and store. The whole chain must succeed for `ok`. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) {
    return {
      enabled: false,
      supported: false,
      detail: "This browser has no web push support.",
    };
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return {
      enabled: false,
      supported: true,
      detail: "Notification permission was not granted.",
    };
  }
  // The worker carries the push handlers; on the dev server it stays
  // unregistered by design (lib/pwa.ts explains why) — push is a
  // deployed-app feature.
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBytes(VAPID_PUBLIC_KEY),
    });
  }
  const json = subscription.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    return {
      enabled: false,
      supported: true,
      detail: "The subscription this browser produced is incomplete.",
    };
  }

  const { supabaseAvailable, getSupabase } = await import(
    "@/lib/supabase/client"
  );
  const { sessionStore } = await import("@/lib/supabase/session");
  const account = sessionStore().account();
  if (!supabaseAvailable || !account) {
    return {
      enabled: false,
      supported: true,
      detail: "Push works with the Supabase backend and a signed-in account.",
    };
  }
  const { error } = await getSupabase().from("push_subscriptions").upsert(
    {
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_id: account.id,
      user_agent: navigator.userAgent,
    },
    { onConflict: "endpoint" },
  );
  if (error) {
    return { enabled: false, supported: true, detail: error.message };
  }
  return {
    enabled: true,
    supported: true,
    detail: "Push notifications are on for this browser.",
  };
}

/** Unsubscribe this browser and drop its row, so the sender stops trying. */
export async function disablePush(): Promise<PushState> {
  const subscription = await currentSubscription();
  if (!subscription) {
    return {
      enabled: false,
      supported: pushSupported(),
      detail: "Push was already off.",
    };
  }
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => undefined);

  const { supabaseAvailable, getSupabase } = await import(
    "@/lib/supabase/client"
  );
  if (supabaseAvailable) {
    await getSupabase()
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint);
  }
  return {
    enabled: false,
    supported: pushSupported(),
    detail: "Push notifications are off.",
  };
}
