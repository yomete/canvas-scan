# Claude Code instructions

## Cross-agent review loop

- Treat `CODEX_REVIEW.md` as the shared, append-only review log; the bottommost status line is authoritative.
- Before starting, resuming, or claiming completion, read the latest Codex review section and its status.
- If it ends with `CODEX_STATUS: CHANGES_REQUESTED`, address every current finding, append a concise Fable response with changed files and verification, then end with `FABLE_STATUS: READY_FOR_CODEX`.
- Do not claim review approval until the latest Codex section ends with `CODEX_STATUS: APPROVED`.
- Preserve prior Codex and Fable sections; append new sections instead of rewriting review history.
