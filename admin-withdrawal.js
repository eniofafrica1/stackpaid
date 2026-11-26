import { adminDb, json, method, adminFromRequest, fail } from "../lib/server.js";
export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  try {
    await adminFromRequest(req);
    const { withdrawal_id, decision, payout_reference } = req.body || {};
    if (!withdrawal_id || !["paid", "rejected"].includes(decision))
      throw new Error("Choose paid or rejected.");
    const { data: row, error: rErr } = await adminDb.from("withdrawals")
      .select("id,user_id,amount,status").eq("id", withdrawal_id).single();
    if (rErr || !row) throw new Error("Withdrawal not found.");
    if (row.status !== "pending") throw new Error("Withdrawal already processed.");
    if (decision === "paid" && !payout_reference)
      throw new Error("Enter the bank transfer reference before marking paid.");
    const { data, error } = await adminDb.rpc("stackpaid_review_withdrawal", {
      p_withdrawal_id: withdrawal_id,
      p_decision: decision,
      p_payout_reference: payout_reference || null
    });
    if (error) throw error;
    json(res, 200, { message: decision === "paid" ? "Payout recorded." : "Withdrawal rejected and balance returned.", result: data });
  } catch (e) { fail(res, e); }
}
