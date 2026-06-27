# Project docs (BMAD-style living docs)

These are **living documents** — every working session updates them. They keep
decisions, advice, and history outside of chat so the project stays continuous
across sessions and reviewers.

## The set

| File | Purpose | Update when |
| --- | --- | --- |
| [DECISIONS.md](DECISIONS.md) | ADR-style log: each notable decision + why + date | any architectural/product decision is made |
| [SESSION-LOG.md](SESSION-LOG.md) | What changed each session (+ commit refs) | end of every session / phase |
| [ADVICE.md](ADVICE.md) | Open recommendations & options (domain, SEO, future) | when advice is given or an option is chosen |

Authoritative roadmaps stay at the repo root:
[NEXT_STAGE_PLAN.md](../NEXT_STAGE_PLAN.md) (phases A–D),
[SEO_PLAN.md](../SEO_PLAN.md), [README.md](../README.md), and the
[UX_AUDIT.md](../UX_AUDIT.md).

## Conventions

- **Honesty first** (project-wide): never fabricate market data — prices,
  ranges, freshness, probabilities, or "finds profitable flips" claims. Sample/
  fixture data is labelled as such everywhere, including JSON-LD.
- **Independent review:** run the codex MCP review before moving between phases;
  fix blockers/majors before proceeding.
- **Ship discipline:** each step ships with tests; commit + push keeps `main`
  (and the Vercel prod deploy) up to date.
- **Update these docs every session.**
