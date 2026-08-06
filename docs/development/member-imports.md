# Member import parser setup (CSV/XLSX + paste)

This guide shows the exact setup format for bulk organization invitations.

## Quick start

1. Go to **Organization Settings → Bulk Import Members**.
2. Choose role (**member** or **staff**).
3. Use either:
   - **File Upload** (`.csv`, `.xlsx`, `.xls`)
   - **Paste Emails** (freeform text, CSV-style lines, `Name <email>`)
4. Review parser output and send invites.
5. Use **Invitation History** to resend any pending/failed deliveries.

## CSV template

Use the downloadable template at:

- `/templates/member-import-template.csv`

Minimum accepted shape:

```csv
email,name
lea.kim@example.org,Lea Kim
noah.chen@example.org,Noah Chen
```

### Header compatibility

The parser prefers an explicit email header, but can infer columns when needed.
Common accepted email headers include:

- `email`
- `email address`
- `mail`

`name` is optional.

## XLSX guidance

- First worksheet is used.
- Keep one contact per row.
- Put email in a consistent column.
- Avoid merged cells in data rows.

## Paste mode examples

Supported examples:

```text
Maya Patel <maya.patel@example.org>
jordan@example.org
Ari Singh, ari.singh@example.org
```

## Parser behavior

- Auto-normalizes emails to lowercase.
- Removes duplicate emails within the same import.
- Rejects invalid email rows.
- Tracks invalid rows and delivery-stage failures separately.

## Invite + resend behavior

- Successful sends create **pending** invitations and send invite emails.
- If email delivery fails, the invite remains pending for retry.
- Admins can resend from **Invitation History**.

## Troubleshooting

### "Could not find an email column"

Add a clear email header (`email`) or move emails into one consistent column.

### Many invalid rows

- Ensure one person per row.
- Remove extra explanatory text from file cells.
- Confirm spreadsheet export preserved headers.

### Sent count lower than valid rows

Some rows may fail during delivery stage (provider/network issues). Use **resend** in Invitation History.
