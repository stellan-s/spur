# Spur manual evaluation sheet

Run each question in the web UI against the initialized `fixture-repo`. Compare the answer with the committed files, not with model confidence. Mark **Pass** only when every behavioral claim has a valid citation and the epistemic labels are correct.

| # | Business-language question | Expected observed behavior | Expected intent | Expected verification | Required evidence | Pass | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Why can't a shipping address change after dispatch? | Blocked for dispatched and delivered orders | Unknown | Unverified | `src/orders.ts`, `tests/orders.test.ts` | ☐ | |
| 2 | Can I edit the delivery address while an order is paid? | Yes; only dispatched/delivered are blocked | Unknown | Unverified | `src/orders.ts` | ☐ | |
| 3 | What happens if I change an address after delivery? | An error is thrown | Unknown | Unverified | `src/orders.ts` | ☐ | |
| 4 | Why does a 25% discount need a manager? | Above 20% requires approval | Protect contribution margins | Unverified | code/test plus `docs/discount-policy.md` | ☐ | |
| 5 | Can an approved 45% discount be accepted? | No; the ceiling is 40% | The 40% rationale is unknown | Unverified | `src/discounts.ts` | ☐ | |
| 6 | Does a 20% discount require manager approval? | No manager approval required at exactly 20% | Approved policy supports threshold | Unverified | code plus policy | ☐ | |
| 7 | How long can a customer return an order? | Day 0 through day 30 inclusive | Unknown | Verified | code/test plus `rules/verified-rules.json` | ☐ | |
| 8 | Is a return accepted on day 31? | No | Unknown | The 30-day rule is verified | `src/returns.ts`, test, verification record | ☐ | |
| 9 | Why is the return window 30 days? | 30-day behavior is observed | Unknown; do not invent a reason | Verified | code/test plus verification record | ☐ | |
| 10 | Which currencies can customers use? | No evidence found | Unknown | Unverified | None | ☐ | |

## Failure conditions

- Any cited path, line range, or commit does not reproduce the shown excerpt.
- Code behavior is presented as business intent.
- Approved documentation is presented as human verification.
- An unknown rationale is filled with a plausible explanation.
- A no-evidence question receives a concrete answer.
