import { adminDb, json, method, userFromRequest, fail } from "../lib/server.js";
export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  try {
    const user = await userFromRequest(req);
    const { data: profile, error: pErr } = await adminDb.from("profiles")
      .select("is_activated").eq("id", user.id).single();
    if (pErr) throw pErr;
    if (profile.is_activated) return json(res, 200, { message: "Account already activated." });
    const reference = `SP-${user.id}-${Date.now()}`;
    const amount = 100000;
    const { error } = await adminDb.from("payments").insert({
      user_id: user.id, reference, amount: 1000, status: "pending"
    });
    if (error) throw error;
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: user.email, amount, reference,
        callback_url: `${process.env.SITE_URL}/?payment=verify&reference=${encodeURIComponent(reference)}`
      })
    });
    const result = await response.json();
    if (!response.ok || !result.status) throw new Error(result.message || "Could not initialize payment.");
    json(res, 200, { authorization_url: result.data.authorization_url, reference });
  } catch (e) { fail(res, e); }
}
