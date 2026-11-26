import { adminDb, json, method, adminFromRequest, fail } from "../lib/server.js";
export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  try {
    await adminFromRequest(req);
    const { title, platform, description, reward, task_url } = req.body || {};
    if (!title || !platform || !task_url || !Number.isFinite(Number(reward)) || Number(reward) <= 0)
      throw new Error("Complete all task fields with a valid reward.");
    const { data, error } = await adminDb.from("tasks").insert({
      title, platform, description: description || "", reward: Number(reward), task_url, status: "active"
    }).select().single();
    if (error) throw error;
    json(res, 201, { task: data });
  } catch (e) { fail(res, e); }
}
