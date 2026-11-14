/** Typed client for the PillPal REST API (contracts 5.3). The agent never touches the DB. */
import {
  CallEndedResponse,
  EscalateResponse,
  IdResponse,
  OkResponse,
  PatientContext,
  type CallEndedBody,
  type CallStartedBody,
  type CreateDoseBody,
  type EscalateBody,
  type MemoryBody,
  type SymptomBody,
} from "@pillpal/shared";
import type { z } from "zod";

const base = () => (process.env.API_URL ?? "http://localhost:8787").replace(/\/$/, "");

async function call<S extends z.ZodType>(
  method: "GET" | "POST",
  path: string,
  schema: S,
  body?: unknown,
): Promise<z.infer<S>> {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  // Never include request/response bodies in errors (patient data).
  if (!res.ok) throw new Error(`API ${method} ${path.replace(/[0-9a-f-]{36}/g, ":id")} → ${res.status}`);
  return schema.parse(await res.json());
}

export const api = {
  context: (patientId: string) => call("GET", `/patients/${patientId}/context`, PatientContext),
  dose: (b: CreateDoseBody) => call("POST", "/doses", IdResponse, b),
  symptom: (b: SymptomBody) => call("POST", "/symptoms", OkResponse, b),
  memory: (b: MemoryBody) => call("POST", "/memories", IdResponse, b),
  callStarted: (b: CallStartedBody) => call("POST", "/calls/started", IdResponse, b),
  callEnded: (b: CallEndedBody) => call("POST", "/calls/ended", CallEndedResponse, b),
  escalate: (b: EscalateBody) => call("POST", "/escalate", EscalateResponse, b),
};
