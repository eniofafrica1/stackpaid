import { adminDb, json, method, userFromRequest, fail } from "../lib/server.js";
export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  try {
    const user = await userFromRequest(req);
    const { task_id, proof } = req.body || {};
    if (!task_id || !proof || typeof proof !== "string" || proof.length > 2000)
      throw new Error("Provide a task and proof.");
    const { data: profile, error: pErr } = await adminDb.from("profiles")
      .select("is_activated").eq("id", user.id).single();
    if (pErr) throw pErr;
    if (!profile.is_activated) throw new Error("Activate your account first.");
    const { data: task, error: tErr } = await adminDb.from("tasks")
      .select("id").eq("id", task_id).eq("status", "active").single();
    if (tErr || !task) throw new Error("Task is unavailable.");
    const { error } = await adminDb.from("task_submissions").insert({
      user_id: user.id, task_id, proof, status: "pending"
    });
    if (error) throw error;
    json(res, 201, { message: "Proof submitted for review." });
  } catch (e) { fail(res, e); }
}
