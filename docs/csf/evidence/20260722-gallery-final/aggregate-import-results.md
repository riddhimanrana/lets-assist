# Synthetic import aggregate

## Captured preview

| Measure | Count |
|---|---:|
| Preview rows | 6 |
| Ready rows | 4 |
| Rows requiring review | 2 |
| Existing normalized matches | 3 |
| Committed rows in this captured preview | 0 |

## Captured row outcomes

- One sanitized row resolves as an update to an existing record.
- One sanitized row remains ambiguous and is not guessed.
- One sanitized row remains an error and is not committed.
- Commit is blocked because the exact Drive source file, tab, and bounded range are missing from the synthetic capture.

## Interpretation

- These numbers are synthetic UI-fixture evidence only; they do not represent a live DVHS roster or a real Google Sheet import.
- The gallery demonstrates preview-before-commit and row-level reconciliation behavior.
- Live Drive aggregate reconciliation remains outside this sanitized artifact until the local OAuth redirect is authorized and the intended CSF Google identity is visibly confirmed.
- No live Google OAuth, Picker selection, Drive read, real import, token refresh, reconnect/revocation, or Google write was performed.
- No Sheet is modified and no background synchronization or writeback occurs. No production or Vela data source was accessed.
