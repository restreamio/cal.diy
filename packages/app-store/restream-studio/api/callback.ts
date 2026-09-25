import { getSafeRedirectUrl } from "@calcom/lib/getSafeRedirectUrl";
import logger from "@calcom/lib/logger";
import prisma from "@calcom/prisma";
import type { NextApiRequest, NextApiResponse } from "next";
import getInstalledAppPath from "../../_utils/getInstalledAppPath";
import createOAuthAppCredential from "../../_utils/oauth/createOAuthAppCredential";
import { decodeOAuthState } from "../../_utils/oauth/decodeOAuthState";
import setDefaultConferencingApp from "../../_utils/setDefaultConferencingApp";
import appConfig from "../config.json";
import type { RestreamCredentialKey } from "../lib/oauth";
import { getRestreamRedirectUri, requestRestreamToken } from "../lib/oauth";

const log = logger.getSubLogger({ prefix: ["app-store/restream-studio/api/callback"] });

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const userId = req.session?.user?.id;
  if (!userId) {
    return res.status(401).json({ message: "You must be logged in to do this" });
  }

  const state = decodeOAuthState(req);
  const installedAppPath = getInstalledAppPath({ variant: appConfig.variant, slug: appConfig.slug });
  const { code } = req.query;

  if (typeof code !== "string") {
    res.redirect(getSafeRedirectUrl(state?.onErrorReturnTo) ?? installedAppPath);
    return;
  }

  if (!state) {
    return res.status(400).json({ message: "Invalid OAuth state" });
  }

  let credentialKey: RestreamCredentialKey;
  try {
    credentialKey = await requestRestreamToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: getRestreamRedirectUri(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    log.error("Restream code exchange failed", message);
    return res.status(400).json({ message });
  }

  await prisma.credential.deleteMany({
    where: { type: appConfig.type, userId, appId: appConfig.slug },
  });

  await createOAuthAppCredential({ appId: appConfig.slug, type: appConfig.type }, credentialKey, req);

  if (state.defaultInstall) {
    await setDefaultConferencingApp(userId, appConfig.slug);
  }

  res.redirect(getSafeRedirectUrl(state.returnTo) ?? installedAppPath);
}
