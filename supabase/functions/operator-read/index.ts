import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_ORIGINS = new Set([
  "https://nisti-identificacao.lksntz1411.workers.dev"
]);

function corsHeaders(request: Request) {
  const origin = String(request.headers.get("origin") || "").trim();
  const allowedOrigin = ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://nisti-identificacao.lksntz1411.workers.dev";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "content-type, x-user-id, x-client-info",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Credentials": "false",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };
}

function json(data: unknown, status = 200, request?: Request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(request || new Request("https://nisti.local")), "Content-Type": "application/json; charset=utf-8" }
  });
}

function cleanUserId(value: string | null) {
  const normalized = String(value || "").trim().slice(0, 100);
  if (normalized === "op_guest") return normalized;
  return /^op_[0-9a-f-]{36}$/i.test(normalized) ? normalized : "op_guest";
}

async function rpc(name: string, body: Record<string, unknown> = {}) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) throw new Error("supabase_config_missing");

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    console.error("operator_read_rpc_failed", name, response.status, await response.text().catch(() => ""));
    throw new Error(`rpc_${response.status}`);
  }
  return response.json();
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (request.method !== "GET") return json({ error: "Método não permitido." }, 405, request);

  const url = new URL(request.url);
  const resource = String(url.searchParams.get("resource") || "").trim().toLowerCase();
  const origin = String(request.headers.get("origin") || "").trim();
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json({ error: "Origem não autorizada." }, 403, request);
  }
  const userId = cleanUserId(request.headers.get("x-user-id"));

  try {
    if (resource === "notifications") {
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 50));
      const payload = await rpc("nisti_reserve_notifications_v1", {
        p_user_id: userId,
        p_limit: limit
      });
      const rows = Array.isArray(payload) ? payload : [];
      const notifications = rows
        .filter((row: any) => (row?.type || "new_cover") === "new_cover")
        .map((row: any) => ({
          id: Number(row.id),
          type: row.type || "new_cover",
          capa_code: row.capa_code || null,
          product_id: row.product_id ? Number(row.product_id) : null,
          sku: row.sku || null,
          product_name: row.product_name || null,
          variacao: row.variacao || null,
          platform: row.platform || null,
          image_url: null,
          is_read: row.is_read === true || Number(row.is_read) === 1,
          read_at: row.read_at || null,
          created_at: row.created_at || null
        }));
      return json({
        notifications,
        unread_count: notifications.filter((item: any) => !item.is_read).length,
        source: "supabase-direct"
      }, 200, request);
    }

    if (resource === "notifications-unread") {
      const payload = await rpc("nisti_reserve_notifications_v1", {
        p_user_id: userId,
        p_limit: 100
      });
      const rows = Array.isArray(payload) ? payload : [];
      const unread_count = rows.filter((row: any) =>
        (row?.type || "new_cover") === "new_cover"
        && !(row?.is_read === true || Number(row?.is_read) === 1)
      ).length;
      return json({ unread_count, source: "supabase-direct" }, 200, request);
    }

    if (resource === "mural-unread") {
      const payload = await rpc("nisti_reserve_mural_unread_v1", { p_user_id: userId });
      return json({ unread_count: Number(payload || 0), source: "supabase-direct" }, 200, request);
    }

    return json({ error: "Recurso não suportado.", technical_error: "resource_invalid" }, 404, request);
  } catch (error) {
    console.error("operator_read_unhandled", error);
    return json({ error: "Leitura direta temporariamente indisponível.", technical_error: "supabase_direct_unavailable" }, 503, request);
  }
});
