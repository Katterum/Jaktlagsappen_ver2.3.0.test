import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

type Role = "viewer" | "member" | "leader" | "admin";
type Action = "list" | "upsert" | "delete-access";
interface Payload { action: Action; teamId: string; userId?: string; memberId?: string | null; username?: string; password?: string; role?: Role; active?: boolean; }
const ERIK_USER_ID = "5e2d1b6e-e579-4a3a-8136-3fdcabbb1fe8";
const ERIK_USERNAME = "erik";
const roles = new Set<Role>(["viewer", "member", "leader", "admin"]);
const reply = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });
const clean = (v: unknown) => String(v || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });
    try {
      const body: Payload = await req.json();
      const teamId = String(body.teamId || "").trim();
      if (!teamId) return reply({ ok: false, error: "Jaktlagets ID saknas." }, 400);
      const { data: { user: caller }, error: callerError } = await ctx.supabase.auth.getUser();
      if (callerError || !caller) return reply({ ok: false, error: "Du är inte inloggad." }, 401);
      const { data: callerMembership } = await ctx.supabaseAdmin.from("team_memberships").select("role, active").eq("team_id", teamId).eq("user_id", caller.id).maybeSingle();
      if (!callerMembership || callerMembership.role !== "admin" || callerMembership.active !== true) return reply({ ok: false, error: "Endast en aktiv administratör får hantera användare." }, 403);

      if (body.action === "list") {
        const { data, error } = await ctx.supabaseAdmin.from("team_memberships").select("user_id, member_id, username, role, active, created_at").eq("team_id", teamId).order("created_at", { ascending: true });
        if (error) return reply({ ok: false, error: error.message }, 500);
        return reply({ ok: true, users: data || [] });
      }

      const username = clean(body.username);
      const userIdInput = String(body.userId || "").trim();
      const { data: existing } = userIdInput
        ? await ctx.supabaseAdmin.from("team_memberships").select("user_id, member_id, username, role, active").eq("team_id", teamId).eq("user_id", userIdInput).maybeSingle()
        : username
        ? await ctx.supabaseAdmin.from("team_memberships").select("user_id, member_id, username, role, active").eq("team_id", teamId).eq("username", username).maybeSingle()
        : { data: null };

      if (body.action === "delete-access") {
        if (!existing) return reply({ ok: false, error: "Användaren hittades inte." }, 404);
        if (existing.user_id === ERIK_USER_ID || existing.username === ERIK_USERNAME) return reply({ ok: false, error: "Eriks administratörskonto är skyddat." }, 400);
        const { error: membershipError } = await ctx.supabaseAdmin.from("team_memberships").delete().eq("team_id", teamId).eq("user_id", existing.user_id);
        if (membershipError) return reply({ ok: false, error: membershipError.message }, 500);
        const { error: authError } = await ctx.supabaseAdmin.auth.admin.deleteUser(existing.user_id);
        if (authError) return reply({ ok: false, error: "Appåtkomsten togs bort, men Auth-kontot kunde inte raderas: " + authError.message }, 500);
        return reply({ ok: true, deleted: true, member_id: existing.member_id });
      }

      if (body.action !== "upsert") return reply({ ok: false, error: "Okänd åtgärd." }, 400);
      if (!username) return reply({ ok: false, error: "Användarnamn saknas." }, 400);
      let role: Role = roles.has(body.role as Role) ? body.role as Role : "member";
      let active = body.active !== false;
      const protectedErik = username === ERIK_USERNAME || existing?.user_id === ERIK_USER_ID || existing?.username === ERIK_USERNAME;
      if (protectedErik) { role = "admin"; active = true; }
      const memberId = body.memberId == null || String(body.memberId).trim() === "" ? null : String(body.memberId).trim();
      const password = String(body.password || "");
      if (password && password.length < 8) return reply({ ok: false, error: "Lösenordet måste vara minst 8 tecken." }, 400);
      let userId = existing?.user_id || null;
      if (!userId) {
        if (!password) return reply({ ok: false, error: "Nya användare måste skapas med lösenord." }, 400);
        const { data: created, error } = await ctx.supabaseAdmin.auth.admin.createUser({ email: `${username}@katterums-jaktlag.invalid`, password, email_confirm: true, user_metadata: { username, team_id: teamId } });
        if (error || !created.user) return reply({ ok: false, error: error?.message || "Auth-användaren kunde inte skapas." }, 400);
        userId = created.user.id;
      } else if (password) {
        const { error } = await ctx.supabaseAdmin.auth.admin.updateUserById(userId, { password });
        if (error) return reply({ ok: false, error: error.message }, 400);
      }
      const row = { team_id: teamId, user_id: userId, member_id: memberId, username, role, active };
      const query = existing
        ? ctx.supabaseAdmin.from("team_memberships").update(row).eq("team_id", teamId).eq("user_id", userId)
        : ctx.supabaseAdmin.from("team_memberships").insert(row);
      const { error } = await query;
      if (error) { if (!existing && userId) await ctx.supabaseAdmin.auth.admin.deleteUser(userId); return reply({ ok: false, error: error.message }, 500); }
      return reply({ ok: true, user: row });
    } catch (error) {
      console.error("manage-user error", error);
      return reply({ ok: false, error: "Användaråtgärden kunde inte behandlas." }, 500);
    }
  })
};
