# Issue & PR Label Taxonomy

This document defines every GitHub label used in **soroban-merkle-airdrop**, their colours, and the situations in which they should be applied.

Apply labels when opening an issue or PR. Every issue should carry at least one **Type** label and, where relevant, one **Area** label. **Difficulty** labels are optional but encouraged for issues that are open for external contribution.

---

## 🔖 Type Labels

These describe *what kind of change* the issue or PR represents.

| Label | Color | Description | When to use |
|-------|-------|-------------|-------------|
| `bug` | `#d73a4a` | Something is broken or behaves incorrectly | Unexpected behaviour, wrong output, runtime panics, failed transactions |
| `feature` | `#0075ca` | A brand-new capability that does not exist yet | New contract entry points, new CLI commands, new SDK methods, new pages |
| `enhancement` | `#a2eeef` | An improvement to existing functionality | Better error messages, performance improvements, UX polish on an existing flow |
| `docs` | `#0052cc` | Documentation-only changes | Adding or updating READMEs, guides, inline comments, or docstrings |
| `test` | `#bfd4f2` | Adding or improving tests without changing production code | New unit/integration tests, raising coverage, fixing flaky assertions |
| `security` | `#e4e669` | A vulnerability or security-hardening change | Proof-verification edge cases, replay attacks, integer overflows, supply-chain issues |
| `refactor` | `#d4c5f9` | Code restructuring with no observable behaviour change | Renaming symbols, splitting large modules, removing dead code |
| `ci` | `#f9d0c4` | Changes to the CI/CD pipeline | Editing GitHub Actions workflows, adding lint steps, matrix changes |
| `chore` | `#e4e669` | Maintenance tasks that are not features or bug fixes | Bumping dependencies, updating `.gitignore`, tidying config files |

---

## 🗂️ Area Labels

These describe *which part of the codebase* is affected.

| Label | Color | Description | When to use |
|-------|-------|-------------|-------------|
| `area:contract` | `#c5def5` | Soroban smart contract (`contracts/airdrop/`) | Changes to `lib.rs`, `merkle.rs`, `types.rs`, or contract tests |
| `area:merkle` | `#c5def5` | Core Merkle algorithm (shared between Rust and TypeScript) | Changes to hashing logic, leaf/node construction, proof verification in any layer |
| `area:sdk` | `#c5def5` | TypeScript SDK (`sdk/`) | Changes to `merkle.ts`, `client.ts`, `types.ts`, or SDK tests |
| `area:cli` | `#c5def5` | Command-line tool (`cli/`) | Changes to `generate`, `claim`, `status`, or `deploy` commands |
| `area:frontend` | `#c5def5` | Next.js claim UI (`web/`) | Changes to pages, components, or frontend configuration |
| `area:deployment` | `#c5def5` | Deployment scripts, Stellar CLI usage, or testnet/mainnet setup | Changes to deploy guides, initialization scripts, or network configuration |
| `area:docs` | `#c5def5` | Documentation files (`docs/`, `README.md`, `CONTRIBUTING.md`) | Changes that only touch documentation, not code |
| `area:community` | `#c5def5` | Community health files and contributor experience | Changes to `CODE_OF_CONDUCT.md`, issue/PR templates, label definitions |

---

## 🎯 Difficulty Labels

These signal the estimated effort required and help new contributors find suitable issues.

| Label | Color | Description | When to use |
|-------|-------|-------------|-------------|
| `good first issue` | `#7057ff` | Ideal entry point for first-time contributors | Well-scoped tasks with clear acceptance criteria and no deep domain knowledge required |
| `help wanted` | `#008672` | Extra attention or outside expertise is needed | Stalled issues, tasks outside the core team's bandwidth, or research-heavy problems |
| `difficulty:easy` | `#c2e0c6` | Estimated under 1 hour of focused work | Typo fixes, single-line changes, trivial config updates |
| `difficulty:medium` | `#fef2c0` | Estimated 1–4 hours of focused work | Adding a new CLI flag, writing a new test file, small algorithm changes |
| `difficulty:hard` | `#f9d0c4` | Estimated more than 4 hours or requires deep domain knowledge | New contract entry points, cryptographic changes, multi-workspace refactors |

---

## Applying Labels

1. **Issues** — add at minimum one Type label. Add an Area label if the affected component is clear. Add a Difficulty label if the issue is open for community contribution.
2. **Pull Requests** — mirror the Type and Area labels of the issue(s) it closes. Add `security` if any cryptographic or access-control code is touched, regardless of the primary type.
3. **Multiple labels** — it is normal for an issue to have several labels, e.g. `bug` + `area:contract` + `difficulty:hard`.

---

## Requesting a New Label

Open an issue with the `area:community` label and propose the label name, colour, and description. Labels are only added after discussion to keep the taxonomy lean.
