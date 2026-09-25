---
status: accepted
---

# Each listing field records which Extraction supplied it

When several sources describe the same Production or Performance, merge picks one value per field. Every field's current value records the Extraction it came from (Field lineage), so any value on the site can be traced to a source document and a fetch.

## Considered Options

- **A link table plus source-role precedence**: the listing links to all its Extractions, but individual fields aren't traced. It is simpler, but rejected because it can't answer "where did this start time come from?"

## Consequences

- There is more schema and more merge code: lineage is written on every merge and must be kept when a field doesn't change.
- Debugging a wrong listing starts from its lineage rather than from re-running the pipeline.
