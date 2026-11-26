import { createClient } from "@supabase/supabase-js";

export const adminDb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export function json(res, status, data) {
  res.status(status).setHeader("Content-Type", "application/json").json(data);
}

export function method(req, res, allowed) {
  if (!allowed.includes(req.method)) {
    json(res, 405, { error: "Method not allowed" });
    return false;
  }
  return true;
}

export async function userFromRequest(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new Error("Please log in.");
  const { data, error } = await adminDb.auth.getUser(token);
  if (error || !data.user) throw new Error("Invalid or expired session.");
  return data.user;
}

export async function adminFromRequest(req) {
  const user = await userFromRequest(req);
  const { data, error } = await adminDb
    .from("profiles").select("is_admin").eq("id", user.id).single();
  if (error || data?.is_admin !== true) throw new Error("Administrator access required.");
  return user;
}

export function fail(res, error) {
  const message = error?.message || "Unexpected server error.";
  json(res, 400, { error: message });
}
