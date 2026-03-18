# Byzantine War Room — CEO Dashboard

Sales pipeline dashboard for Byzantine Finance. Static React app synced daily via Python + GitHub Actions, deployed on Vercel.

## Architecture

- `src/sync.py` fetches from 4 sources (Attio, Fireflies, Gmail, Google Calendar)
- Generates `public/data.json`
- GitHub Action runs daily at 07:00 UTC, commits + pushes `data.json`
- Vercel auto-deploys on push
- Dashboard is pure static (React via Babel standalone, no build step)

## Setup

### 1. Clone & install

```bash
git clone git@github.com:byzantine/byzantine-dashboard.git
cd byzantine-dashboard
cp .env.example .env
pip install -r src/requirements.txt
```

### 2. Google OAuth (one-time)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create project "Byzantine Dashboard"
3. Enable **Gmail API** + **Google Calendar API**
4. Create OAuth2 credentials (Desktop app) → download `credentials.json`
5. Run the auth setup:

```bash
cp credentials.json src/
cd src && python auth_setup.py
```

6. Sign in with the Gaia Google account
7. Base64-encode both files:

```bash
base64 -w0 token.json     # → GOOGLE_TOKEN_JSON
base64 -w0 credentials.json  # → GOOGLE_CREDENTIALS_JSON
```

### 3. Environment variables

Set in `.env` for local dev, and as GitHub Secrets for CI:

- `ANTHROPIC_API_KEY` — Anthropic API key (for Attio + Fireflies MCP)
- `GOOGLE_TOKEN_JSON` — base64-encoded `token.json`
- `GOOGLE_CREDENTIALS_JSON` — base64-encoded `credentials.json`

### 4. Test locally

```bash
python src/sync.py
cd public && python -m http.server 8000
# Open http://localhost:8000
```

### 5. Deploy

1. Connect repo to [Vercel](https://vercel.com) — Framework: Other, Root: `public`
2. Add GitHub Secrets (Settings → Secrets → Actions)
3. Enable the GitHub Action

### 6. Manual refresh

```bash
gh workflow run sync.yml
```

### 7. Token renewal

If the Google refresh token expires (~6 months for GCP projects in "testing" mode), re-run `python src/auth_setup.py` and update the GitHub Secret.
