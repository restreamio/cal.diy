import { WEBAPP_URL } from "@calcom/lib/constants";
import prisma from "@calcom/prisma";
import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import createOAuthAppCredential from "../../_utils/oauth/createOAuthAppCredential";
import { decodeOAuthState } from "../../_utils/oauth/decodeOAuthState";
import setDefaultConferencingApp from "../../_utils/setDefaultConferencingApp";
import type { IntegrationOAuthCallbackState } from "../../types";
import { exchangeRestreamCode } from "../lib/oauth";
import handler from "./callback";

vi.mock("@calcom/prisma", () => ({ default: { credential: { deleteMany: vi.fn() } } }));
vi.mock("../../_utils/oauth/createOAuthAppCredential", () => ({ default: vi.fn() }));
vi.mock("../../_utils/oauth/decodeOAuthState", () => ({ decodeOAuthState: vi.fn() }));
vi.mock("../../_utils/setDefaultConferencingApp", () => ({ default: vi.fn() }));
vi.mock("../lib/oauth", () => ({ exchangeRestreamCode: vi.fn() }));

const mockDecodeOAuthState = vi.mocked(decodeOAuthState);
const mockExchangeRestreamCode = vi.mocked(exchangeRestreamCode);
const mockCreateOAuthAppCredential = vi.mocked(createOAuthAppCredential);
const mockSetDefaultConferencingApp = vi.mocked(setDefaultConferencingApp);
const mockDeleteMany = vi.mocked(prisma.credential.deleteMany);

const INSTALLED_APP_PATH = "/apps/installed/conferencing?hl=restream-studio";
const RETURN_TO = `${WEBAPP_URL}/apps/installed/conferencing`;
const TOKEN = {
  access_token: "access",
  refresh_token: "refresh",
  expiry_date: 1_700_000_000_000,
};

const buildState = (
  overrides: Partial<IntegrationOAuthCallbackState> = {}
): IntegrationOAuthCallbackState => ({
  onErrorReturnTo: `${WEBAPP_URL}/apps/restream-studio`,
  fromApp: true,
  ...overrides,
});

const buildReq = (query: Record<string, string>, userId: number | null = 1): NextApiRequest =>
  ({ query, session: userId ? { user: { id: userId } } : undefined }) as unknown as NextApiRequest;

const buildRes = () => {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
    redirect: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
};

const callHandler = async (req: NextApiRequest) => {
  const res = buildRes();
  await handler(req, res as unknown as NextApiResponse);
  return res;
};

describe("restream-studio callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDecodeOAuthState.mockReturnValue(buildState({ returnTo: RETURN_TO }));
    mockExchangeRestreamCode.mockResolvedValue(TOKEN);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await callHandler(buildReq({ code: "abc" }, null));

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockExchangeRestreamCode).not.toHaveBeenCalled();
  });

  it("redirects back to the app when the user denies access", async () => {
    mockDecodeOAuthState.mockReturnValue(undefined);

    const res = await callHandler(buildReq({}));

    expect(res.redirect).toHaveBeenCalledWith(INSTALLED_APP_PATH);
    expect(mockExchangeRestreamCode).not.toHaveBeenCalled();
  });

  it("rejects the code exchange when the state is invalid", async () => {
    mockDecodeOAuthState.mockReturnValue(undefined);

    const res = await callHandler(buildReq({ code: "abc", state: "{}" }));

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "Invalid OAuth state" });
    expect(mockExchangeRestreamCode).not.toHaveBeenCalled();
  });

  it("returns the Restream error when the code exchange fails", async () => {
    mockExchangeRestreamCode.mockRejectedValue(new Error("Invalid grant: authorization code is invalid"));

    const res = await callHandler(buildReq({ code: "bad", state: "{}" }));

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "Invalid grant: authorization code is invalid" });
    expect(mockCreateOAuthAppCredential).not.toHaveBeenCalled();
  });

  it("replaces the existing credential with the new token and redirects to returnTo", async () => {
    const req = buildReq({ code: "abc", state: "{}" });

    const res = await callHandler(req);

    expect(mockExchangeRestreamCode).toHaveBeenCalledWith("abc");
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { type: "restream-studio_conferencing", userId: 1, appId: "restream-studio" },
    });
    expect(mockCreateOAuthAppCredential).toHaveBeenCalledWith(
      { appId: "restream-studio", type: "restream-studio_conferencing" },
      TOKEN,
      req
    );
    expect(mockSetDefaultConferencingApp).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(RETURN_TO);
  });

  it("sets the app as default conferencing app when requested", async () => {
    mockDecodeOAuthState.mockReturnValue(buildState({ defaultInstall: true }));

    const res = await callHandler(buildReq({ code: "abc", state: "{}" }));

    expect(mockSetDefaultConferencingApp).toHaveBeenCalledWith(1, "restream-studio");
    expect(res.redirect).toHaveBeenCalledWith(INSTALLED_APP_PATH);
  });
});
