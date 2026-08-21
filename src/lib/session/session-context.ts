// The raw React Context object + its value type, split out from
// provider.tsx and use-session.ts so neither of those files mixes a
// component export with a non-component export (react-refresh needs a file
// to export only components to fast-refresh it).

import * as React from "react";
import type { ClaimResponse, MeGroup, MeUser } from "@/lib/schemas/auth";

export type SessionStatus = "loading" | "signed-in" | "signed-out";

export interface SessionContextValue {
  status: SessionStatus;
  user: MeUser | null;
  groups: MeGroup[];
  refresh: () => Promise<void>;
  signInAnonymous: (displayName: string) => Promise<void>;
  claimEmail: (email: string) => Promise<ClaimResponse>;
  logout: () => Promise<void>;
}

export const SessionContext = React.createContext<SessionContextValue | null>(null);
