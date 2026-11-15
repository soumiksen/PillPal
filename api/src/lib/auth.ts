/**
 * Signed-in users for the routes the web portal calls (supabase/002_accounts.sql).
 * The web sends the Supabase access token as `Authorization: Bearer <token>`; we verify it with
 * Supabase Auth and check the care team. Agent routes (context, doses, calls, …) don't use this.
 */
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AccountRole } from "@pillpal/shared";
import { db } from "../db.js";
import { must } from "./data.js";

export interface AuthUser {
  id: string;
  role: AccountRole;
}

const KEY = "pillpal_user";

/** 401 unless the request carries a valid Supabase session token. */
export const requireUser: MiddlewareHandler = async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new HTTPException(401, { message: "sign_in_required" });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HTTPException(401, { message: "sign_in_required" });
  const profile = must("get profile", await db.from("profiles").select("role").eq("id", data.user.id).maybeSingle()) as
    | { role: AccountRole }
    | null;
  c.set(KEY as never, { id: data.user.id, role: profile?.role ?? "caregiver" } satisfies AuthUser as never);
  await next();
};

export function currentUser(c: Context): AuthUser {
  const u = c.get(KEY as never) as AuthUser | undefined;
  if (!u) throw new HTTPException(401, { message: "sign_in_required" });
  return u;
}

/** 403 unless the signed-in user is on this patient's care team. */
export async function assertCareTeam(c: Context, patientId: string): Promise<AuthUser> {
  const user = currentUser(c);
  const row = must(
    "check care team",
    await db.from("care_team").select("user_id").eq("user_id", user.id).eq("patient_id", patientId).maybeSingle(),
  );
  if (!row) throw new HTTPException(403, { message: "not_on_care_team" });
  return user;
}

/** Add a user to a patient's care team (idempotent). */
export async function addToCareTeam(userId: string, patientId: string, role: AccountRole): Promise<void> {
  must(
    "add to care team",
    await db.from("care_team").upsert({ user_id: userId, patient_id: patientId, role }, { onConflict: "user_id,patient_id", ignoreDuplicates: true }),
  );
}
