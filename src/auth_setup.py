#!/usr/bin/env python3
"""One-time OAuth2 setup script.

Run locally to generate token.json for Google APIs.
Then base64-encode it and add to GitHub Secrets as GOOGLE_TOKEN_JSON.
"""

from google_auth_oauthlib.flow import InstalledAppFlow
import json

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
]

flow = InstalledAppFlow.from_client_secrets_file("credentials.json", SCOPES)
creds = flow.run_local_server(port=0)

with open("token.json", "w") as f:
    f.write(creds.to_json())

print("token.json created. Base64 encode it and add to GitHub Secrets:")
print("  base64 -w0 token.json")
