import { WEBAPP_URL } from "@calcom/lib/constants";
import prisma from "@calcom/prisma";
import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import createOAuthAppCredential from "../../_utils/oauth/createOAuthAppCredential";
import { decodeOAuthState } from "../../_utils/oauth/decodeOAuthState";
import setDefaultConferencingApp from "../../_utils/setDefaultConferencingApp";
import { requestRestreamToken } from "../lib/oauth";
import handler from "./callback";

vi.mock("@calcom/prisma", () => ({ default: { credential: { deleteMany: vi.fn() } } }));
vi.mock("../../_utils/oauth/createOAuthAppCredential", () => ({ default: vi.fn() }));
vi.mock("../../_utils/oauth/decodeOAuthState", () => ({ decodeOAuthState: vi.fn() }));
vi.mock("../../_utils/setDefaultConferencingApp", () => ({ default: vi.fn() }));
vi.mock("../lib/oauth", () => ({
  requestRestreamToken: vi.fn(),
  getRestreamRedirectUri: () => "http://localhost:3000/api/integrations/restream-studio/callback",
}));

const mockDecodeOAuthState = vi.mocked(decodeOAuthState);
const mockRequestRestreamToken = vi.mocked(requestRestreamToken);
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
    mockDecodeOAuthState.mockReturnValue({ returnTo: RETURN_TO });
    mockRequestRestreamToken.mockResolvedValue(TOKEN);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await callHandler(buildReq({ code: "abc" }, null));

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockRequestRestreamToken).not.toHaveBeenCalled();
  });

  it("redirects back to the app when the user denies access", async () => {
    mockDecodeOAuthState.mockReturnValue(undefined);

    const res = await callHandler(buildReq({}));

    expect(res.redirect).toHaveBeenCalledWith(INSTALLED_APP_PATH);
    expect(mockRequestRestreamToken).not.toHaveBeenCalled();
  });

  it("rejects the code exchange when the state is invalid", async () => {
    mockDecodeOAuthState.mockReturnValue(undefined);

    const res = await callHandler(buildReq({ code: "abc", state: "{}" }));

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "Invalid OAuth state" });
    expect(mockRequestRestreamToken).not.toHaveBeenCalled();
  });

  it("returns the Restream error when the code exchange fails", async () => {
    mockRequestRestreamToken.mockRejectedValue(new Error("Invalid grant: authorization code is invalid"));

    const res = await callHandler(buildReq({ code: "bad", state: "{}" }));

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "Invalid grant: authorization code is invalid" });
    expect(mockCreateOAuthAppCredential).not.toHaveBeenCalled();
  });

  it("replaces the existing credential with the new token and redirects to returnTo", async () => {
    const req = buildReq({ code: "abc", state: "{}" });

    const res = await callHandler(req);

    expect(mockRequestRestreamToken).toHaveBeenCalledWith({
      grant_type: "authorization_code",
      code: "abc",
      redirect_uri: "http://localhost:3000/api/integrations/restream-studio/callback",
    });
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
    mockDecodeOAuthState.mockReturnValue({ defaultInstall: true });

    const res = await callHandler(buildReq({ code: "abc", state: "{}" }));

    expect(mockSetDefaultConferencingApp).toHaveBeenCalledWith(1, "restream-studio");
    expect(res.redirect).toHaveBeenCalledWith(INSTALLED_APP_PATH);
  });
});
