import { adminDb, json, method, adminFromRequest, fail } from "../lib/server.js";
export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  try {
    await adminFromRequest(req);
    const { submission_id, decision } = req.body || {};
    if (!submission_id || !["approved", "rejected"].includes(decision))
      throw new Error("Invalid review request.");
    const { data: sub, error: sErr } = await adminDb.from("task_submissions")
      .select("id,user_id,task_id,status").eq("id", submission_id).single();
    if (sErr || !sub) throw new Error("Submission not found.");
    if (sub.status !== "pending") throw new Error("This submission has already been reviewed.");
    if (decision === "rejected") {
      const { error } = await adminDb.from("task_submissions").update({ status: "rejected" })
        .eq("id", submission_id).eq("status", "pending");
      if (error) throw error;
      return json(res, 200, { message: "Submission rejected." });
    }
    const { data: task, error: tErr } = await adminDb.from("tasks")
      .select("reward").eq("id", sub.task_id).single();
    if (tErr || !task) throw new Error("Task not found.");
    const { data: result, error } = await adminDb.rpc("stackpaid_approve_submission", {
      p_submission_id: submission_id,
      p_reward: Number(task.reward)
    });
    if (error) throw error;
    json(res, 200, { message: "Submission approved and reward credited.", result });
  } catch (e) { fail(res, e); }
}
