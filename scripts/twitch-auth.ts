import "dotenv/config";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { getTokenInfo } from "@twurple/auth";

const { TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET } = process.env;
const redirectUri =
  process.env.TWITCH_REDIRECT_URI ??
  "http://localhost:3000/auth/twitch/callback";
const tokenFile = resolve(
  process.env.TWITCH_TOKEN_FILE ?? "./.data/twitch-tokens.json",
);
const scopes = ["user:read:chat"];

if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) {
  console.error(
    "Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in .env before running this script.",
  );
  process.exitCode = 1;
} else {
  const state = randomBytes(24).toString("hex");
  const redirect = new URL(redirectUri);
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", redirect.origin);
    if (requestUrl.pathname !== redirect.pathname) {
      response.writeHead(404).end("Not found");
      return;
    }
    if (requestUrl.searchParams.get("state") !== state) {
      response.writeHead(400).end("OAuth state mismatch");
      return;
    }
    const code = requestUrl.searchParams.get("code");
    if (!code) {
      response.writeHead(400).end("Missing authorization code");
      return;
    }
    try {
      const tokenResponse = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: TWITCH_CLIENT_ID,
          client_secret: TWITCH_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenResponse.ok)
        throw new Error(
          `Twitch token exchange failed (${tokenResponse.status})`,
        );
      const token = (await tokenResponse.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string[];
      };
      if (!token.access_token || !token.refresh_token || !token.expires_in)
        throw new Error("Twitch returned an incomplete token response.");
      const savedToken = {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresIn: token.expires_in,
        obtainmentTimestamp: Date.now(),
        scope: token.scope ?? scopes,
      };
      const tokenInfo = await getTokenInfo(
        savedToken.accessToken,
        TWITCH_CLIENT_ID,
      );
      if (!tokenInfo.userId)
        throw new Error("Twitch token has no user identity.");
      const accountToken = { ...savedToken, userId: tokenInfo.userId };
      let existingTokens: Array<Record<string, unknown>> = [];
      try {
        const existing = JSON.parse(
          await readFile(tokenFile, "utf8"),
        ) as unknown;
        existingTokens = (
          Array.isArray(existing) ? existing : [existing]
        ) as Array<Record<string, unknown>>;
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ))
          throw error;
      }
      existingTokens = existingTokens.filter(
        (entry) => entry.userId !== tokenInfo.userId,
      );
      existingTokens.push(accountToken);
      await mkdir(dirname(tokenFile), { recursive: true });
      await writeFile(tokenFile, JSON.stringify(existingTokens, null, 2), {
        mode: 0o600,
      });
      const accountHash = createHash("sha256")
        .update(String(token.access_token ?? ""))
        .digest("hex")
        .slice(0, 12);
      response
        .writeHead(200, { "content-type": "text/plain; charset=utf-8" })
        .end("Twitch authorization saved. You may close this tab.");
      console.log(
        `Authorization saved to ${tokenFile} (access token fingerprint ${accountHash}).`,
      );
      server.close();
    } catch (error) {
      response.writeHead(500).end("Authorization failed; see terminal output.");
      console.error(
        error instanceof Error ? error.message : "Authorization failed",
      );
      server.close();
      process.exitCode = 1;
    }
  });
  server.listen(Number(redirect.port || 80), redirect.hostname, () => {
    const authorizeUrl = new URL("https://id.twitch.tv/oauth2/authorize");
    authorizeUrl.search = new URLSearchParams({
      client_id: TWITCH_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopes.join(" "),
      state,
    }).toString();
    console.log(`Open this URL to authorize Raid Relay:\n${authorizeUrl}`);
    console.log(
      `Waiting for callback at ${redirect.origin}${redirect.pathname}`,
    );
  });
}
