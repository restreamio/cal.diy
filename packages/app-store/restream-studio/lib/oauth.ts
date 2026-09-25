import { WEBAPP_URL_FOR_OAUTH } from "@calcom/lib/constants";
import { z } from "zod";
import getAppKeysFromSlug from "../../_utils/getAppKeysFromSlug";
import appConfig from "../config.json";
import { appKeysSchema } from "../zod";

export const RESTREAM_AUTHORIZE_URL = "https://api.restream.io/login";
export const RESTREAM_TOKEN_URL = "https://api.restream.io/oauth/token";

const restreamTokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

export type RestreamCredentialKey = {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  scope?: string;
  token_type?: string;
};

export const getRestreamAppKeys = async (): Promise<z.infer<typeof appKeysSchema>> => {
  const appKeys = await getAppKeysFromSlug(appConfig.slug);
  return appKeysSchema.parse(appKeys);
};

export const getRestreamRedirectUri = (): string =>
  `${WEBAPP_URL_FOR_OAUTH}/api/integrations/${appConfig.slug}/callback`;

const getRestreamErrorMessage = async (response: Response): Promise<string> => {
  const fallback = `Restream token request failed with status ${response.status}`;
  try {
    const body = await response.json();
    return body?.error?.message ?? fallback;
  } catch {
    return fallback;
  }
};

export const requestRestreamToken = async (
  params: Record<string, string>
): Promise<RestreamCredentialKey> => {
  const { client_id, client_secret } = await getRestreamAppKeys();
  const response = await fetch(RESTREAM_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${client_id}:${client_secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });

  if (!response.ok) {
    throw new Error(await getRestreamErrorMessage(response));
  }

  const { expires_in, ...token } = restreamTokenResponseSchema.parse(await response.json());
  return { ...token, expiry_date: Math.round(Date.now() + expires_in * 1000) };
};
