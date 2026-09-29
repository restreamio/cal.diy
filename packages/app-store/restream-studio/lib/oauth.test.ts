import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import getAppKeysFromSlug from "../../_utils/getAppKeysFromSlug";
import {
  exchangeRestreamCode,
  fetchRestreamToken,
  getRestreamAppKeys,
  getRestreamRedirectUri,
  RESTREAM_TOKEN_URL,
} from "./oauth";

vi.mock("../../_utils/getAppKeysFromSlug", () => ({ default: vi.fn() }));
vi.mock("@calcom/lib/constants", () => ({
  WEBAPP_URL_FOR_OAUTH: "https://app.cal.com",
}));

const mockGetAppKeysFromSlug = vi.mocked(getAppKeysFromSlug);
const fetchMock = vi.fn();

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("restream-studio oauth", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    vi.stubGlobal("fetch", fetchMock);
    mockGetAppKeysFromSlug.mockResolvedValue({ client_id: "client-id", client_secret: "client-secret" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe("getRestreamAppKeys", () => {
    it("reads keys by the app slug", async () => {
      await expect(getRestreamAppKeys()).resolves.toEqual({
        client_id: "client-id",
        client_secret: "client-secret",
      });
      expect(mockGetAppKeysFromSlug).toHaveBeenCalledWith("restream-studio");
    });

    it("throws when keys are not configured", async () => {
      mockGetAppKeysFromSlug.mockResolvedValue({});
      await expect(getRestreamAppKeys()).rejects.toThrow();
    });
  });

  it("builds the callback redirect uri from the app slug", () => {
    expect(getRestreamRedirectUri()).toBe("https://app.cal.com/api/integrations/restream-studio/callback");
  });

  describe("fetchRestreamToken", () => {
    it("sends the grant as a form body with client credentials as basic auth", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}));

      await fetchRestreamToken({ grant_type: "refresh_token", refresh_token: "refresh" });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(RESTREAM_TOKEN_URL);
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({
        Authorization: `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      });
      expect(Object.fromEntries(init.body)).toEqual({
        grant_type: "refresh_token",
        refresh_token: "refresh",
      });
    });

    it("returns error responses without throwing", async () => {
      const response = jsonResponse(
        { error: { message: "Invalid grant: refresh token is invalid", name: "invalid_grant" } },
        400
      );
      fetchMock.mockResolvedValue(response);

      await expect(
        fetchRestreamToken({ grant_type: "refresh_token", refresh_token: "refresh" })
      ).resolves.toBe(response);
    });
  });

  describe("exchangeRestreamCode", () => {
    it("exchanges the code and returns the token with an absolute expiry", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
          scope: "profile.read channels.read",
          token_type: "Bearer",
          accessToken: "access",
          refreshToken: "refresh",
        })
      );

      const token = await exchangeRestreamCode("abc");

      expect(token).toEqual({
        access_token: "access",
        refresh_token: "refresh",
        scope: "profile.read channels.read",
        token_type: "Bearer",
        expiry_date: new Date("2026-01-01T01:00:00.000Z").getTime(),
      });
      expect(Object.fromEntries(fetchMock.mock.calls[0][1].body)).toEqual({
        grant_type: "authorization_code",
        code: "abc",
        redirect_uri: "https://app.cal.com/api/integrations/restream-studio/callback",
      });
    });

    it("throws the Restream error message on a failed request", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          { error: { message: "Invalid grant: authorization code is invalid", name: "invalid_grant" } },
          400
        )
      );

      await expect(exchangeRestreamCode("bad")).rejects.toThrow(
        "Invalid grant: authorization code is invalid"
      );
    });

    it("falls back to the status code when the error body is not JSON", async () => {
      fetchMock.mockResolvedValue(new Response("Bad gateway", { status: 502 }));

      await expect(exchangeRestreamCode("abc")).rejects.toThrow(
        "Restream token request failed with status 502"
      );
    });
  });
});
