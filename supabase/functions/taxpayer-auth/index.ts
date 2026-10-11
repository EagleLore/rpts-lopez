import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { action, taxpayer_id, password } = await req.json();

    if (action === "login") {
      const { data: taxpayer, error } = await supabase
        .from("taxpayer_users")
        .select("*")
        .eq("taxpayer_id", taxpayer_id)
        .eq("is_active", true)
        .maybeSingle();

      if (error || !taxpayer) {
        return new Response(
          JSON.stringify({ error: "Taxpayer ID not found or inactive" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: verifyResult, error: verifyError } = await supabase.rpc(
        "verify_taxpayer_password",
        {
          input_taxpayer_id: taxpayer_id,
          input_password: password,
        }
      );

      if (verifyError || !verifyResult) {
        return new Response(
          JSON.stringify({ error: "Invalid Taxpayer ID or password" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          taxpayer: {
            id: taxpayer.id,
            taxpayer_id: taxpayer.taxpayer_id,
            full_name: taxpayer.full_name,
            email: taxpayer.email,
            phone: taxpayer.phone,
            address: taxpayer.address,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
