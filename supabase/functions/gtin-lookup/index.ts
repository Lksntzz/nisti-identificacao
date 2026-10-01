import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "no-store"
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" }
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "GET") return json({ error: "Método não permitido." }, 405);

  const gtin = new URL(request.url).searchParams.get("gtin")?.trim() || "";
  if (!/^\d{13}$/.test(gtin)) {
    return json({ error: "EAN-13 inválido.", technical_error: "gtin_invalid" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Base de EAN indisponível.", technical_error: "supabase_config_missing" }, 503);
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/rpc/nisti_reserve_gtin_lookup_v1`,
      {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify({ p_gtin: gtin })
      }
    );

    if (!response.ok) {
      console.error("gtin_lookup_rpc_failed", response.status, await response.text().catch(() => ""));
      return json({ error: "Não foi possível consultar o EAN.", technical_error: "gtin_lookup_upstream" }, 503);
    }

    const payload = await response.json().catch(() => []);
    const row = Array.isArray(payload) ? payload[0] : null;
    if (!row) {
      return json({ error: "GTIN não cadastrado.", technical_error: "gtin_not_found", gtin }, 404);
    }

    return json({
      ok: true,
      gtin,
      product: {
        id: Number(row.id),
        sku: row.sku || "",
        miolo_code: row.miolo_code || "",
        capa_code: row.capa_code || "",
        acabamento_code: row.acabamento_code || "",
        wireo_code: row.wireo_code || "",
        tassel_code: row.tassel_code || "",
        elastico_code: row.elastico_code || "",
        nome: row.nome || "",
        variacao: row.variacao || "",
        image_key: row.image_key || "",
        image_url: row.image_key ? `/api/images/${Number(row.id)}` : null
      }
    });
  } catch (error) {
    console.error("gtin_lookup_unhandled", error);
    return json({ error: "Falha de conexão com a base de EAN.", technical_error: "gtin_lookup_transport" }, 503);
  }
});
