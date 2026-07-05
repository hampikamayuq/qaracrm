# Shadow Mode Runbook

## Phase 1: Shadow

1. Set `SHADOW_MODE=shadow`.
2. Set `TWENTY_FORWARD_URL` to the current Twenty Meta webhook URL.
3. Deploy the standalone API with HTTPS.
4. Point the Meta callback URL to the standalone API.
5. The standalone persists `WebhookEvent`, forwards the raw body and original signature to Twenty, then runs Tawany without sending messages.
6. Run the comparison script daily:

```bash
pnpm --filter @qara/api exec tsx src/scripts/shadow-compare.ts
```

## Exit Criteria

- At least 95% of shadow runs complete without Tawany technical errors.
- At least 80% of replies match after normalized or manual semantic review.
- No reply-validator violations for invented prices, unsupported Mohs claims, or unsafe medical promises.

## Phase 2: Human Approval

1. Set `SHADOW_MODE=human_approval`.
2. Remove `TWENTY_FORWARD_URL` only when the team is ready for standalone-only intake.
3. Tawany should create suggestions, but humans approve or reject before sending.

## Phase 3: Autopilot

1. Set `SHADOW_MODE=autopilot`.
2. Allow only low-risk messages to auto-send.
3. Keep medium and high-risk messages behind approval.

## Rollback

Repoint the Meta callback URL back to Twenty in the Meta dashboard. No code rollback is required.
