import { adminDb, json, method, userFromRequest, fail } from "../lib/server.js";
export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  try {
    const user = await userFromRequest(req);
    const { reference } = req.body || {};
    if (!reference) throw new Error("Payment reference is required.");
    const { data: payment, error: pErr } = await adminDb.from("payments")
      .select("*").eq("reference", reference).eq("user_id", user.id).single();
    if (pErr || !payment) throw new Error("Payment record not found.");
    if (payment.status === "successful") return json(res, 200, { success: true });
    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    });
    const result = await response.json();
    if (!response.ok || !result.status || result.data.status !== "success" ||
        Number(result.data.amount) !== 100000 || result.data.currency !== "NGN") {
      await adminDb.from("payments").update({ status: "failed" }).eq("reference", reference);
      throw new Error("Payment could not be verified.");
    }
    const { error: updateErr } = await adminDb.from("payments")
      .update({ status: "successful" }).eq("reference", reference).eq("status", "pending");
    if (updateErr) throw updateErr;
    const { error: profileErr } = await adminDb.from("profiles")
      .update({ is_activated: true }).eq("id", user.id);
    if (profileErr) throw profileErr;
    json(res, 200, { success: true, message: "Account activated." });
  } catch (e) { fail(res, e); }
}
