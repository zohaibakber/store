# Project profile

This skill is the same in every repo. A **profile** is the one file where a repo records what the skill cannot know. `AGENTS.md` or `CLAUDE.md` points at it beside the pointer to this skill, so both are read together.

## What a profile holds

Only facts an agent cannot get from one lookup:

- **Versions and ids.** The Effect version, and the service id prefix (`@acme/<package>/<Name>`).
- **Edges.** One row per host: the host, the shape of its edge, the file to read.
- **Contracts.** Which package holds wire contracts, branded IDs and wire errors.
- **Persistence.** The `SqlClient` driver per process, and the idempotency guarantees the system already has.
- **Decisions.** Local choices that override or narrow the skill: a timestamp representation, a comment policy, a failure the app keeps typed.
- **Exemplars.** The files nearest the target, each listed for the one idea it shows. Where an exemplar differs from the skill, the skill wins.

A rule that holds for Effect code anywhere belongs in the skill, and a fact about one repo belongs in its profile.

## Departures

A profile carries, or points at, the list of **departures**: code that does not meet the target yet.

- An entry names the files, what they do, and the target to move them to. It says whether the problem was reproduced or only read in the source.
- Fix a departure when your task already changes that code. Otherwise leave it and say you saw it.
- Delete an entry in the change that fixes it. Add one when you find a new departure.
- An architecture-sized change (a different process model, a wire format, adopting `effect/workflow` or `effect/eventlog`) goes under its own heading as a decision for the user, with the date and the reason once it is made. A rejected option stays listed so nobody reopens it without a new fact.

A repo with no profile still gets departures reported: say what you saw in your reply.
