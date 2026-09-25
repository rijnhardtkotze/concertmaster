---
status: accepted
---

# Presenter and Ensemble are separate records

The organisation that puts on a Production (the Presenter) and a group that performs in it (an Ensemble) are stored in separate tables, even when they are the same real-world body. The CPO, for example, has one Presenter record and one Ensemble record, joined by a shared slug.

## Considered Options

- **One Organisation record with roles.** It would avoid the duplication, but it was rejected in favour of keeping the two roles distinct. Presenters also include venues and festivals that never perform, and many Ensembles never present their own concerts.

## Consequences

- The shared slug is the only link between the two records. Any page that wants to show "everything about the CPO" has to join on it.
