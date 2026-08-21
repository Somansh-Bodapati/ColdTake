import { describe, expect, it } from "vitest";
import { GOOGLE_STATE_COOKIE_NAME } from "@/lib/auth/google";
import handler from "./google";

describe("GET /api/auth/google", () => {
  it("redirects (302) to a well-formed Google authorize URL and sets a state cookie", async () => {
    const response = await handler(new Request("http://localhost/api/auth/google"));

    expect(response.status).toBe(302);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();

    const url = new URL(String(location));
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(process.env.GOOGLE_CLIENT_ID);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("redirect_uri")).toContain("/api/auth/google/callback");
    expect(url.searchParams.get("state")).toBeTruthy();

    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain(`${GOOGLE_STATE_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");
  });

  it("issues a different state (and thus a different authorize URL) on each call", async () => {
    const first = await handler(new Request("http://localhost/api/auth/google"));
    const second = await handler(new Request("http://localhost/api/auth/google"));

    const firstState = new URL(String(first.headers.get("location"))).searchParams.get("state");
    const secondState = new URL(String(second.headers.get("location"))).searchParams.get("state");
    expect(firstState).not.toBe(secondState);
  });

  it("rejects a non-GET method with 405", async () => {
    const response = await handler(new Request("http://localhost/api/auth/google", { method: "POST" }));
    expect(response.status).toBe(405);
  });
});
