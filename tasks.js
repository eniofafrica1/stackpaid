import { adminDb, json, method, userFromRequest, fail } from "../lib/server.js";
export default async function handler(req, res) {
  if (!method(req, res, ["GET"])) return;
  try {
    await userFromRequest(req);
    const { data, error } = await adminDb.from("tasks")
      .select("id,title,platform,description,reward,task_url,status")
      .eq("status", "active").order("created_at", { ascending: false });
    if (error) throw error;
    json(res, 200, { tasks: data || [] });
  } catch (e) { fail(res, e); }
}
