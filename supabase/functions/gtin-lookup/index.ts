import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() => new Response(
  JSON.stringify({
    error:"Endpoint direto desativado. Use a API oficial do NISTI.",
    technical_error:"direct_edge_access_disabled"
  }),
  {
    status:410,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
      "x-content-type-options":"nosniff"
    }
  }
));
