/**
 * One-off helper to mint a GOOGLE_REFRESH_TOKEN for Google Contacts sync.
 *
 * Reads GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from .env:
 *
 *   npm run google:auth
 *
 * Opens the Google consent screen, catches the redirect on localhost, and
 * prints the refresh token to paste into .env. Add
 * http://localhost:53682/oauth2callback as an authorised redirect URI on the
 * OAuth client first.
 */
import { createServer } from "node:http";
import { auth } from "@googleapis/people";

const PORT = Number(process.env.GOOGLE_OAUTH_PORT || 53682);
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = ["https://www.googleapis.com/auth/contacts"];

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET before running this.");
  process.exit(1);
}

const oauth2Client = new auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // force a refresh token even on repeat authorisations
  scope: SCOPES,
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname !== "/oauth2callback") {
    res.writeHead(404).end();
    return;
  }

  const error = url.searchParams.get("error");
  if (error) {
    res.writeHead(400, { "content-type": "text/plain" }).end(`Authorisation failed: ${error}`);
    console.error(`Authorisation failed: ${error}`);
    server.close();
    process.exit(1);
  }

  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400, { "content-type": "text/plain" }).end("Missing authorisation code.");
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res
      .writeHead(200, { "content-type": "text/plain" })
      .end("Done. You can close this tab and return to the terminal.");

    if (!tokens.refresh_token) {
      console.error(
        "\nNo refresh token returned. Revoke the app at " +
          "https://myaccount.google.com/permissions and run this again."
      );
      process.exitCode = 1;
    } else {
      console.log("\nAdd this to your .env:\n");
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    }
  } catch (err) {
    console.error("Token exchange failed:", err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  console.log("Open this URL in your browser and grant access:\n");
  console.log(`${authUrl}\n`);
  console.log(`Waiting for the redirect on ${REDIRECT_URI} ...`);
});
