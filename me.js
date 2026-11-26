import { adminDb, json, method, userFromRequest, fail } from "../lib/server.js";
export default async function handler(req, res) {
  if (!method(req, res, ["GET"])) return;
  try {
    const user = await userFromRequest(req);
    const { data, error } = await adminDb.from("profiles")
      .select("id,full_name,email,balance,is_activated,is_admin")
      .eq("id", user.id).single();
    if (error) throw error;
    json(res, 200, { profile: data });
  } catch (e) { fail(res, e); }
}
