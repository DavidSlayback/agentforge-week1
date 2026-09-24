# Bugs, Security Flaws & Mitigations

A consolidated catalog of bugs, half-implemented features, security flaws,
and architectural smells in `<Project>` under `<legacy source root>`. Each
finding has an ID, location, severity, description, and a concrete
mitigation. Sourced from the analyses in `ui/`, `modules/`, `data/`, and
`project/`; Critical and High entries are verified against source (see
`VERIFICATION.md`).

This is the working list for the rewrite: what must be fixed, what can be
deleted, what to leave alone, and what to design out of the next
architecture. When a slice resolves an entry, strike it through and append
the slice ID: `~~Title~~ — resolved in slice NN-SS-LL`.

## Severity guide

| Severity | Meaning |
|---|---|
| **Critical** | Direct compromise of authentication or data integrity, or features so broken they fail their stated purpose entirely. Fix before any production use. |
| **High** | Significant security weakening, broken-but-recoverable feature, or design choice that will block modernization. Fix in any rewrite. |
| **Medium** | Incorrect behavior, latent bugs, defense-in-depth gaps, or a smell that is workable today but should not survive a rewrite. |
| **Low** | UX rough edges, dead code, naming inconsistencies, cosmetic issues, minor smells. Optional. |

## Summary

| Category | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| 1. Security: Authentication & Credentials | | | | | |
| 2. Security: Injection & Input Sanitization | | | | | |
| 3. Security: Authorization & Permissions | | | | | |
| 4. Disabled or Half-Implemented Features | | | | | |
| 5. Data Integrity & Concurrency | | | | | |
| 6. Error Handling & Logging | | | | | |
| 7. UI/UX Bugs | | | | | |
| 8. Architectural Smells | | | | | |
| 9. Build / Deployment Risks | | | | | |
| 10. Dead Code & Inconsistencies | | | | | |
| **Total** | | | | | |

---

## 1. Security: Authentication & Credentials

### 1.01 <Short title> — Critical
- **Location:** `<path>:<Function>` (lines <a–b>, verified)
- **Description:** <What is wrong, how it manifests, why it matters. Concrete, with the mechanism.>
- **Mitigation:** <Concrete replacement technique.> *Disposition:* fix in legacy / design out in rewrite / delete.
- **Source analysis:** [`ui/<NAME>.md`](ui/<NAME>.md)

## 2. Security: Injection & Input Sanitization

## 3. Security: Authorization & Permissions

## 4. Disabled or Half-Implemented Features

## 5. Data Integrity & Concurrency

## 6. Error Handling & Logging

## 7. UI/UX Bugs

## 8. Architectural Smells

## 9. Build / Deployment Risks

## 10. Dead Code & Inconsistencies
