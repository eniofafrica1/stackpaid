import { adminDb, json, method, userFromRequest, fail } from "../lib/server.js";
export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  try {
    const user = await userFromRequest(req);
    const { amount, bank_name, account_number, account_name } = req.body || {};
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 5000 || !bank_name || !/^\d{10}$/.test(account_number || "") || !account_name)
      throw new Error("Enter a valid withdrawal amount (minimum ₦5,000) and bank details.");
    const { data: profile, error: pErr } = await adminDb.from("profiles")
      .select("is_activated,balance").eq("id", user.id).single();
    if (pErr) throw pErr;
    if (!profile.is_activated) throw new Error("Activate your account first.");
    if (Number(profile.balance) < value) throw new Error("Insufficient available balance.");
    const { data, error } = await adminDb.rpc("stackpaid_request_withdrawal", {
      p_user_id: user.id, p_amount: value, p_bank_name: bank_name,
      p_account_number: account_number, p_account_name: account_name
    });
    if (error) throw error;
    json(res, 201, { message: "Withdrawal request submitted.", withdrawal: data });
  } catch (e) { fail(res, e); }
}
