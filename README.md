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
| `GOOGLE_CLIENT_ID` | OAuth client ID for Google Contacts sync |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret for Google Contacts sync |
| `GOOGLE_REFRESH_TOKEN` | OAuth refresh token with Google People API scope |

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

### Google Contacts Access

To automatically add onboarding contacts when a member PR is submitted:

1. Create OAuth credentials in Google Cloud for the Google People API.
2. Generate a refresh token with `https://www.googleapis.com/auth/contacts` scope.
3. Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN` to your `.env`.

`POST /api/submitMember` returns a message with the Google Contacts sync outcome (added, updated, skipped, or failed).

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /api/checkMember` | Verify if a phone number belongs to a registered member |
| `POST /api/submitMember` | Register a new community member |
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
│   ├── github.ts           # GitHub API integration
│   └── validation.ts       # Input validation
├── types/
│   └── membersdb.ts        # TypeScript types for member data
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
```
