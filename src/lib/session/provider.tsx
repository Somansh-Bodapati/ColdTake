// Client-side session state: who's signed in, and which groups they're in.
// Wraps the app once in root.tsx; every route reads it via
// src/lib/session/use-session.ts instead of re-fetching /api/me itself.

import * as React from "react";
import {
  anonymousSignupResponseSchema,
  claimResponseSchema,
  meResponseSchema,
  type ClaimResponse,
  type MeGroup,
  type MeUser,
} from "@/lib/schemas/auth";
import { SessionContext, type SessionContextValue } from "@/lib/session/session-context";

async function fetchMe(): Promise<{ user: MeUser; groups: MeGroup[] } | null> {
  const response = await fetch("/api/me", { credentials: "include" });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`GET /api/me failed: ${response.status}`);
  }
  const body = meResponseSchema.parse(await response.json());
  return { user: body.user, groups: body.groups };
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<SessionStatusState>("loading");
  const [user, setUser] = React.useState<MeUser | null>(null);
  const [groups, setGroups] = React.useState<MeGroup[]>([]);

  const applyMe = React.useCallback((me: { user: MeUser; groups: MeGroup[] } | null) => {
    if (me) {
      setUser(me.user);
      setGroups(me.groups);
      setStatus("signed-in");
    } else {
      setUser(null);
      setGroups([]);
      setStatus("signed-out");
    }
  }, []);

  const refresh = React.useCallback(async () => {
    applyMe(await fetchMe());
  }, [applyMe]);

  // Fetch-then-setState is the standard "sync with an external system on
  // mount" effect (React docs: fetching data). The state update happens
  // after the awaited fetch resolves, in a promise callback — not
  // synchronously in the effect body.
  //
  // Bug fix (tonight): a real cookie is a "confirmed not signed in" (401,
  // which fetchMe turns into `null`) OR an "we couldn't tell" failure
  // (network error, a cold Vercel Function / cold Neon connection timing
  // out, a dropped connection) — fetchMe's `catch` used to treat both
  // identically, calling applyMe(null) either way. That's exactly the
  // production bug: a valid 30-day session cookie survives a closed tab
  // just fine, but the very first request a *new* tab makes is also the
  // request most likely to land on a cold path (the tab, and the
  // serverless function + DB connection behind it, have been idle since
  // the tab closed) — hit an unrelated transient error there, and the old
  // code declared the admin signed out and showed the name form. Typing a
  // name then mints a brand-new session cookie under the same name/path,
  // silently shadowing the still-valid one and orphaning their admin
  // access. A single retry after a short delay absorbs that class of
  // blip; only a real 401 (or a second consecutive failure) is treated as
  // actually signed out.
  React.useEffect(() => {
    let cancelled = false;

    async function loadWithRetry(): Promise<void> {
      try {
        const me = await fetchMe();
        if (!cancelled) {
          applyMe(me);
        }
      } catch {
        if (cancelled) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (cancelled) {
          return;
        }
        try {
          const me = await fetchMe();
          if (!cancelled) {
            applyMe(me);
          }
        } catch {
          if (!cancelled) {
            applyMe(null);
          }
        }
      }
    }

    void loadWithRetry();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount, applyMe is stable
  }, []);

  const signInAnonymous = React.useCallback(
    async (displayName: string) => {
      const response = await fetch("/api/auth/anonymous", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      if (!response.ok) {
        throw new Error(await errorMessage(response, "Could not create your account"));
      }
      anonymousSignupResponseSchema.parse(await response.json());
      await refresh();
    },
    [refresh]
  );

  const confirmName = React.useCallback(
    async (displayName: string) => {
      const response = await fetch("/api/auth/confirm-name", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      if (!response.ok) {
        throw new Error(await errorMessage(response, "Could not save your name"));
      }
      await refresh();
    },
    [refresh]
  );

  const claimEmail = React.useCallback(async (email: string): Promise<ClaimResponse> => {
    const response = await fetch("/api/auth/claim", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!response.ok) {
      throw new Error(await errorMessage(response, "Could not send the claim link"));
    }
    return claimResponseSchema.parse(await response.json());
  }, []);

  const logout = React.useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    applyMe(null);
  }, [applyMe]);

  const value = React.useMemo<SessionContextValue>(
    () => ({ status, user, groups, refresh, signInAnonymous, confirmName, claimEmail, logout }),
    [status, user, groups, refresh, signInAnonymous, confirmName, claimEmail, logout]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

type SessionStatusState = SessionContextValue["status"];

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => ({}));
  if (typeof body === "object" && body !== null && "error" in body) {
    return String((body as { error: unknown }).error);
  }
  return fallback;
}
