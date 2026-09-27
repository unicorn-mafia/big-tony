# Big Tony

Big Tony is a WhatsApp Agent powered by [Wassist](https://wassist.app). It handles community member management, membership verification, and demo submissions.

## Production

The production Big Tony agent is available on WhatsApp at: **+44 7488 895960**

## Local Development Setup

### Prerequisites

- Node.js (v18+)
- npm
- [ngrok](https://ngrok.com/) account and CLI installed
- [Wassist](https://wassist.app) account

### 1. Clone and Install

```bash
git clone https://github.com/unicorn-mafia/big-tony.git
cd big-tony
npm install
```

### 2. Environment Variables

Copy the environment template and configure your variables:

```bash
cp .env.template .env
```

Required environment variables:

| Variable | Description |
|----------|-------------|
| `API_KEY` | API key to access the big tony - used to authenticate requests from Wassist |
| `RESEND_API_KEY` | API key from [Resend](https://resend.com) for sending emails |
| `GITHUB_TOKEN` | GitHub Personal Access Token (see [GitHub Access](#github-access)) |
| `GOOGLE_CLIENT_ID` | OAuth client ID for Google Contacts sync (optional, see [Google Contacts Sync](#google-contacts-sync)) |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret for Google Contacts sync (optional) |
| `GOOGLE_REFRESH_TOKEN` | OAuth refresh token with the `contacts` scope (optional) |

### 3. Start the Development Server

```bash
npm run dev
```

The server runs on `http://localhost:3000`.

### 4. Expose with ngrok

Start ngrok to get a public URL for your local server:

```bash
ngrok http 3000
```

Copy the generated `https://*.ngrok.io` URL - you'll need this for Wassist.

### 5. Configure Wassist

1. Create an account at [wassist.app](https://wassist.app)
2. Create a new agent
3. Copy the contents of `wassist/system_prompt.txt` and paste it into the agent's system prompt field
4. For each tool in the `wassist/tools/` directory:
   - Open the JSON file (`checkMember.json`, `submitDemo.json`, `submitMember.json`)
   - In Wassist, upload/create an API tool using the JSON configuration
   - Replace `<url>` in the tool config with your ngrok URL
   - Replace `Bearer big-tony-api-key` in the tool config with the API key from your `.env` file - generate this
5. Click **Start Testing** to connect your WhatsApp for testing

## External Service Configuration

### Email Sending (Resend)

To test email functionality:

1. Create an account at [resend.com](https://resend.com)
2. Generate an API key
3. Add the key to your `.env` file as `RESEND_API_KEY`

### GitHub Access

The bot requires GitHub access to manage the members database in the `members0db` repository.

1. Go to GitHub → Settings → Developer settings → Personal access tokens
2. Generate a new token (classic) with the `repo` scope
3. Ensure your account has access to the `members0db` repository
4. Add the token to your `.env` file as `GITHUB_TOKEN`

### Google Contacts Sync

When a member joins, Big Tony also adds them to your Google Contacts. This is
optional - if the three `GOOGLE_*` variables are unset the sync is skipped and
everything else works as normal.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a
   project and enable the **People API**.
2. Create an **OAuth client ID** of type *Web application*, and add
   `http://localhost:53682/oauth2callback` as an authorised redirect URI.
3. Put the client ID and secret in your `.env`, then mint a refresh token:

   ```bash
   npm run google:auth
   ```

   This opens a consent screen, asks for the `contacts` scope, and prints a
   `GOOGLE_REFRESH_TOKEN=...` line to paste into your `.env`.

**Behaviour**

- Contacts are deduplicated on **phone number** in E.164 form, so the same
  person is never added twice - `+44 7700 900123`, `447700900123` and
  `00447700900123` all resolve to the same contact.
- If the number already exists, the existing contact is **never overwritten**.
  Only fields that are currently blank get filled in (organisation, GitHub /
  LinkedIn URLs, notes), and existing URLs are preserved.
- Data is validated before anything is written. A member without a valid E.164
  phone number is not added at all, since the phone number is the deduplication
  key. A malformed LinkedIn or GitHub link is simply left off the contact rather
  than blocking the join.
- Failures never break the join flow - `POST /api/submitMember` still returns
  the PR result, with the sync outcome under `google_contacts`.

Run the sync's test suite (fully offline, against a fake People API):

```bash
npm run test:contacts
```

### Abuse Protection

`POST /api/submitMember` is authenticated, but a leaked API key or a looping
agent could still flood your contact book. Three independent guards, all
optional to configure and all on by default:

| Guard | Default | Env var |
|---|---|---|
| Requests per minute | 10 | `SUBMIT_MEMBER_RATE_LIMIT`, `SUBMIT_MEMBER_RATE_WINDOW_MS` |
| Requests per phone number per hour | 3 | `SUBMIT_MEMBER_PHONE_LIMIT`, `SUBMIT_MEMBER_PHONE_WINDOW_MS` |
| New contacts per rolling 24h | 25 | `GOOGLE_CONTACTS_DAILY_LIMIT` |
| Kill switch | on | `GOOGLE_CONTACTS_SYNC_ENABLED="false"` |

The first two are in-memory sliding windows checked in the route, the overall
one before the request body is even parsed so a flood cannot cost GitHub or
Google calls. They return `429` with a `Retry-After` header. Being in-memory,
they reset on a cold start and are not shared between instances - they stop
runaway loops and bursts, but they are not a hard guarantee.

The daily contact cap is the one that actually protects your Google account. It
is derived from the contact list itself: every contact this service creates is
stamped with a marker in its notes, and the existing duplicate scan counts how
many carry that marker with a timestamp inside the last 24 hours. That means the
budget survives restarts, holds across instances, and needs no database. Over
budget, creation is refused with status `rate_limited`; filling blanks on a
contact that already exists is still allowed, since that adds no clutter.

The kill switch stops all contact writes without removing your credentials.

### Why the sync cannot delete contacts

The `contacts` OAuth scope is necessarily read-write and includes the right to
delete - Google offers no create-and-update-but-not-delete scope. The
restriction is enforced in code instead, in three layers:

1. **No route exposes it.** The only path that touches Google is
   `POST /api/submitMember`, which creates or enriches. Big Tony can only call
   the tools defined in `wassist/tools/`, none of which delete anything, so no
   WhatsApp message - however it is phrased - can reach a deletion.
2. **The client is type-narrowed.** `lib/googleContacts.ts` declares a
   `ContactsClient` type exposing only `connections.list`, `createContact` and
   `updateContact`. `deleteContact`, `batchDeleteContacts` and
   `deleteContactPhoto` are compile errors, not a matter of discipline.
3. **A regression test guards it.** `npm run test:contacts` fails if any
   destructive People API call appears anywhere in `lib/`.

Updates are also field-scoped: `updatePersonFields` only ever names fields being
actively written, so an update cannot blank a field by omission.

The residual risk is credential theft - anyone holding `GOOGLE_REFRESH_TOKEN`
can call Google directly and bypass all of the above. Keep it out of the repo
(`.env` is gitignored), and note that Google Contacts keeps deleted contacts in
the bin for 30 days and offers "Undo changes" to roll the whole contact book
back to an earlier point within that window.

### Why the OAuth redirect URI is localhost

The redirect URI is only used by `npm run google:auth`, which you run once on
your own machine to mint the refresh token. The deployed server never performs
an OAuth redirect: it exchanges the stored refresh token for access tokens
directly against Google, with no browser and no callback involved. So the
localhost URI stays correct in production, and the deployed app has no OAuth
callback route to attack.

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /api/checkMember` | Verify if a phone number belongs to a registered member |
| `POST /api/submitMember` | Register a new community member (opens a PR and syncs them to Google Contacts) |
| `POST /api/submitDemo` | Submit a demo for review |

## Project Structure

```
big-tony/
├── app/
│   ├── api/
│   │   ├── checkMember/    # Member verification endpoint
│   │   ├── submitDemo/     # Demo submission endpoint
│   │   └── submitMember/   # Member registration endpoint
│   └── ...
├── lib/
│   ├── authorization.ts    # Request authorization helpers
│   ├── contactData.ts      # Contact validation + normalisation (phone, URLs)
│   ├── github.ts           # GitHub API integration
│   ├── googleContacts.ts   # Google Contacts sync (People API)
│   ├── rateLimit.ts        # Sliding-window rate limiting
│   └── validation.ts       # Input validation
├── types/
│   └── membersdb.ts        # TypeScript types for member data
├── scripts/
│   ├── get-google-refresh-token.mjs  # One-off Google OAuth helper
│   └── test-google-contacts.mts      # Contact sync test suite
└── wassist/
    ├── system_prompt.txt   # Agent system prompt for Wassist
    └── tools/              # Wassist tool configurations (JSON)
```

## Scripts

```bash
npm run dev     # Start development server
npm run build   # Build for production
npm run start   # Start production server
npm run lint    # Run ESLint

npm run test:contacts  # Test the Google Contacts sync (offline)
npm run google:auth    # Mint a Google refresh token for Contacts sync
```
