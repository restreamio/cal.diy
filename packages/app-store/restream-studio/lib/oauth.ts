import { WEBAPP_URL_FOR_OAUTH } from "@calcom/lib/constants";
import { z } from "zod";
import getAppKeysFromSlug from "../../_utils/getAppKeysFromSlug";
import appConfig from "../config.json";
import { appKeysSchema } from "../zod";

const restreamTokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

type RestreamTokenGrant =
  | { grant_type: "authorization_code"; code: string; redirect_uri: string }
  | { grant_type: "refresh_token"; refresh_token: string };

const getRestreamErrorMessage = async (response: Response): Promise<string> => {
  const fallback = `Restream token request failed with status ${response.status}`;
  try {
    const body = await response.json();
    return body?.error?.message ?? fallback;
  } catch {
    return fallback;
  }
};

export const RESTREAM_AUTHORIZE_URL = "https://api.restream.io/login";
export const RESTREAM_TOKEN_URL = "https://api.restream.io/oauth/token";

export type RestreamCredentialKey = Omit<z.infer<typeof restreamTokenResponseSchema>, "expires_in"> & {
  expiry_date: number;
};

export const getRestreamAppKeys = async (): Promise<z.infer<typeof appKeysSchema>> => {
  const appKeys = await getAppKeysFromSlug(appConfig.slug);
  return appKeysSchema.parse(appKeys);
};

export const getRestreamRedirectUri = (): string =>
  `${WEBAPP_URL_FOR_OAUTH}/api/integrations/${appConfig.slug}/callback`;

// Returns the raw response because OAuthManager inspects it to detect a revoked refresh token.
export const fetchRestreamToken = async (grant: RestreamTokenGrant): Promise<Response> => {
  const { client_id, client_secret } = await getRestreamAppKeys();
  return fetch(RESTREAM_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${client_id}:${client_secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(grant),
  });
};

export const exchangeRestreamCode = async (code: string): Promise<RestreamCredentialKey> => {
  const response = await fetchRestreamToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: getRestreamRedirectUri(),
  });

  if (!response.ok) {
    throw new Error(await getRestreamErrorMessage(response));
  }

  const { expires_in, ...token } = restreamTokenResponseSchema.parse(await response.json());
  return { ...token, expiry_date: Math.round(Date.now() + expires_in * 1000) };
};
