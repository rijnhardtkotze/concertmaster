# Domain docs

This repo has one context. The glossary is `CONTEXT.md` and the decisions are in `docs/adr/`, both at the root.

## Read these before you explore

1. `CONTEXT.md`, in full. It is short.
2. Every ADR that touches the area you are working in.

## Name things with the glossary

Name every domain concept by its `CONTEXT.md` term: in code, tests, ticket titles, commits and prose. Each term's _Avoid_ list names the synonyms to drop. A concept the glossary lacks is either invented language, so rename it to an existing term, or a real gap, so note it in the ticket or pull request for the next `grill-with-docs` session.

## Treat ADRs as settled

Build inside the existing ADRs. When your work would contradict one, stop and flag it in so many words:

> _Contradicts ADR 0009 (per-field lineage), but worth reopening because …_

A new decision gets an ADR when it is hard to reverse, would surprise a later reader, and came from a real trade-off. Use the next number and the format of the existing ones.
