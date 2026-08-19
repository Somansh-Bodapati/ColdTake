import * as React from "react";
import { SessionContext, type SessionContextValue } from "@/lib/session/session-context";
import type { MeUser } from "@/lib/schemas/auth";

export function useSession(): SessionContextValue {
  const value = React.useContext(SessionContext);
  if (!value) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return value;
}

export function useUser(): MeUser | null {
  return useSession().user;
}
