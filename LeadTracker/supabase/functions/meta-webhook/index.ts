import "@supabase/functions-js/edge-runtime.d.ts";

const MAX_BODY_BYTES = 1_000_000;
const encoder = new TextEncoder();

type LeadgenChange = {
  field?: unknown;
  value?: {
    leadgen_id?: unknown;
    page_id?: unknown;
    form_id?: unknown;
    created_time?: unknown;
  };
};

type MetaWebhookPayload = {
  object?: unknown;
  entry?: Array<{
    changes?: LeadgenChange[];
  }>;
};

type MetaLead = {
  id?: unknown;
  form_id?: unknown;
  created_time?: unknown;
  field_data?: Array<{
    name?: unknown;
    values?: unknown;
  }>;
};

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function toStringValue(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number") return String(value);
  return null;
}

function toIsoDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function extractLeadFields(fieldData: MetaLead["field_data"]) {
  const fields = new Map<string, string>();

  for (const item of fieldData ?? []) {
    if (typeof item?.name !== "string" || !Array.isArray(item.values)) continue;
    const value = item.values.find((candidate) =>
      typeof candidate === "string" && candidate.trim().length > 0
    );
    if (typeof value === "string") {
      fields.set(item.name.toLowerCase(), value.trim());
    }
  }

  const firstName = fields.get("first_name");
  const lastName = fields.get("last_name");

  return {
    name: fields.get("full_name") ??
      fields.get("name") ??
      ([firstName, lastName].filter(Boolean).join(" ") || null),
    email: fields.get("email") ?? null,
    phone: fields.get("phone_number") ??
      fields.get("phone") ??
      fields.get("mobile_phone") ??
      null,
  };
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[\da-f]{64}$/i.test(hex)) return null;
  return new Uint8Array(
    hex.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)),
  );
}

async function verifySignature(
  body: ArrayBuffer,
  signatureHeader: string | null,
  appSecret: string,
): Promise<boolean> {
  const match = signatureHeader?.match(/^sha256=([\da-f]{64})$/i);
  if (!match) return false;

  const received = hexToBytes(match[1]);
  if (!received) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, body));
  if (expected.length !== received.length) return false;

  let difference = 0;
  for (let i = 0; i < expected.length; i++) {
    difference |= expected[i] ^ received[i];
  }
  return difference === 0;
}

async function fetchMetaLead(
  leadId: string,
  pageAccessToken: string,
  graphApiVersion: string,
): Promise<MetaLead> {
  const url = new URL(
    `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(leadId)}`,
  );
  url.searchParams.set("fields", "id,form_id,created_time,field_data");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${pageAccessToken}` },
  });
  if (!response.ok) {
    console.error("Meta lead lookup failed", { status: response.status });
    throw new Error("Could not retrieve lead details from Meta");
  }

  return await response.json() as MetaLead;
}

async function saveLead(lead: Record<string, unknown>): Promise<void> {
  const supabaseUrl = requiredEnv("SUPABASE_URL").replace(/\/+$/, "");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const url = new URL(`${supabaseUrl}/rest/v1/leads`);
  url.searchParams.set("on_conflict", "meta_lead_id");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(lead),
  });

  if (!response.ok) {
    console.error("Supabase lead insert failed", { status: response.status });
    throw new Error("Could not save lead to Supabase");
  }
}

async function handleRequest(request: Request): Promise<Response> {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const verifyToken = requiredEnv("META_VERIFY_TOKEN");

    if (mode !== "subscribe" || token !== verifyToken || challenge === null) {
      return new Response("Forbidden", { status: 403 });
    }
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, POST" },
    });
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }

  const signatureIsValid = await verifySignature(
    body,
    request.headers.get("x-hub-signature-256"),
    requiredEnv("META_APP_SECRET"),
  );
  if (!signatureIsValid) {
    return Response.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(body)) as MetaWebhookPayload;
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (payload.object !== "page" || !Array.isArray(payload.entry)) {
    return Response.json({ received: true, ignored: true });
  }

  const expectedPageId = requiredEnv("META_PAGE_ID");
  const pageAccessToken = requiredEnv("META_PAGE_ACCESS_TOKEN");
  const graphApiVersion = requiredEnv("META_GRAPH_API_VERSION");
  if (!/^v\d+\.\d+$/.test(graphApiVersion)) {
    throw new Error("META_GRAPH_API_VERSION must look like v25.0");
  }

  for (const entry of payload.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") continue;

      const value = change.value;
      const pageId = toStringValue(value?.page_id);
      const leadId = toStringValue(value?.leadgen_id);
      if (pageId !== expectedPageId) {
        console.warn("Ignoring lead event for an unconfigured Page");
        continue;
      }
      if (!leadId) {
        throw new Error("leadgen event is missing leadgen_id");
      }

      const metaLead = await fetchMetaLead(
        leadId,
        pageAccessToken,
        graphApiVersion,
      );
      const fields = extractLeadFields(metaLead.field_data);
      await saveLead({
        meta_lead_id: leadId,
        name: fields.name,
        email: fields.email,
        phone: fields.phone,
        form_id: toStringValue(metaLead.form_id) ??
          toStringValue(value?.form_id),
        submitted_at: toIsoDate(metaLead.created_time) ??
          toIsoDate(value?.created_time),
      });
    }
  }

  return Response.json({ received: true });
}

Deno.serve(async (request: Request) => {
  try {
    return await handleRequest(request);
  } catch (error) {
    console.error(
      "Meta webhook failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    return Response.json({ error: "Webhook processing failed" }, { status: 500 });
  }
});
