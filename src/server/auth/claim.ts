// POST /api/auth/claim — doc 03 §3.1: { email } -> sends magic link.
//
// TODO(email provider): no provider is wired up yet (docs/DECISIONS.md).
// Until one is chosen, this endpoint does NOT send an email — it logs the
// magic-link URL to the server console and also returns it in the response
// body, so the flow is exercisable end to end in dev/tests. Once a provider
// exists, stop returning claimUrl/token in the response and email it
// instead.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/db/schema";
import { claimRequestSchema, type ClaimResponse } from "@/lib/schemas/auth";
import { createClaimToken, requireUser } from "@/lib/auth/session";
import { jsonResponse, parseJsonBody, withErrorHandling } from "@/lib/http";
import { AppError } from "@/lib/errors";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    throw new AppError(405, "Method not allowed");
  }

  const currentUser = await requireUser(db, request);
  const { email } = await parseJsonBody(request, claimRequestSchema);

  if (currentUser.email) {
    throw new AppError(409, "This account already has an email attached");
  }

  const [existingOwner] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  if (existingOwner && existingOwner.id !== currentUser.id) {
    throw new AppError(409, "That email is already claimed by another account");
  }

  const claim = await createClaimToken(db, currentUser.id, email);
  const appUrl = process.env.APP_URL ?? "http://localhost:5173";
  const claimUrl = `${appUrl}/claim?token=${encodeURIComponent(claim.rawToken)}`;

  // Stand-in for the email provider (see TODO above).
  console.log(`[auth/claim] magic link for ${email}: ${claimUrl}`);

  const body: ClaimResponse = {
    claimUrl,
    token: claim.rawToken,
    expiresAt: claim.expiresAt.toISOString(),
  };
  return jsonResponse(body, { status: 201 });
}

export default withErrorHandling(handler);
