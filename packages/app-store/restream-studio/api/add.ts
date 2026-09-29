import { stringify } from "node:querystring";
import { HttpError } from "@calcom/lib/http-error";
import { defaultHandler } from "@calcom/lib/server/defaultHandler";
import { defaultResponder } from "@calcom/lib/server/defaultResponder";
import type { NextApiRequest } from "next";
import { encodeOAuthState } from "../../_utils/oauth/encodeOAuthState";
import { getRestreamAppKeys, getRestreamRedirectUri, RESTREAM_AUTHORIZE_URL } from "../lib/oauth";

async function handler(req: NextApiRequest): Promise<{ url: string }> {
  if (!req.session?.user?.id) {
    throw new HttpError({ statusCode: 401, message: "You must be logged in to do this" });
  }

  const { client_id } = await getRestreamAppKeys();
  const query = stringify({
    response_type: "code",
    client_id,
    redirect_uri: getRestreamRedirectUri(),
    state: encodeOAuthState(req),
  });

  return { url: `${RESTREAM_AUTHORIZE_URL}?${query}` };
}

export default defaultHandler({
  GET: Promise.resolve({ default: defaultResponder(handler) }),
});
