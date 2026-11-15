/** Request validation, error handling and logging middleware. */
import type { Context, ErrorHandler, MiddlewareHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { Uuid } from "@pillpal/shared";
import type { z } from "zod";

/** 400 with a list of {path, message}. Never echoes the submitted values. */
export class ValidationError extends Error {
  constructor(public readonly issues: { path: string; message: string }[]) {
    super("validation_error");
  }
}

function toIssues(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.join(".") || "(body)", message: i.message }));
}

export function validate<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new ValidationError(toIssues(r.error));
  return r.data;
}

/** Parse + validate a JSON body against a @pillpal/shared schema. */
export async function jsonBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let data: unknown;
  try {
    data = await c.req.json();
  } catch {
    throw new ValidationError([{ path: "(body)", message: "Body must be valid JSON" }]);
  }
  return validate(schema, data);
}

/** Validate a uuid path param. */
export function uuidParam(c: Context, name: string): string {
  const r = Uuid.safeParse(c.req.param(name));
  if (!r.success) throw new ValidationError([{ path: `:${name}`, message: "Must be a uuid" }]);
  return r.data;
}

/** Logs method, path (no query string), status and duration. Never bodies, headers or phones. */
export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = performance.now();
  await next();
  const ms = Math.round(performance.now() - start);
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`);
};

export const onError: ErrorHandler = (err, c) => {
  if (err instanceof ValidationError) {
    return c.json({ error: "validation_error", issues: err.issues }, 400);
  }
  if (err instanceof HTTPException) {
    return c.json({ error: err.message || "http_error" }, err.status);
  }
  // Name + message only: no stack payloads, bodies or request data.
  console.error(`[error] ${c.req.method} ${c.req.path}: ${err.name}: ${err.message}`);
  return c.json({ error: "internal_error" }, 500);
};

export const notFound: NotFoundHandler = (c) => c.json({ error: "not_found" }, 404);
