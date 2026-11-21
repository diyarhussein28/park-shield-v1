# ParkShield

The project guide for developers and AI agents is [AGENTS.md](AGENTS.md): what ParkShield is, the
repository layout, how to run, test, build and deploy it, the hard rules, known traps and the open
to-do list. Read it before changing anything. The live go-live state and team rules are in
[docs/status.md](docs/status.md); keep it current.

@AGENTS.md
@docs/status.md

## Standing instructions from the owner (2026-11-21, keep for every session)

- **Commit and push to `main` after every finished part of the code** (a part that builds), without
  asking. Small commits, clear messages.
- **Usage limit:** before the 5-hour or weekly usage limit runs out (at about 98 %), commit and push
  everything and update the handover prompt [docs/handover.md](docs/handover.md): the exact point
  reached, what is still to do, and the designs and styles still to build, so another team member (or
  agent) can continue from there. An agent cannot see the usage meter, so it keeps
  `docs/handover.md` current with **every** commit instead of waiting for the limit.
- **Always answer the owner in Arabic** — every reply, even when the owner's message or command
  contains no Arabic at all (English text, a pasted error, a screenshot, a single command). Code,
  commit messages and docs stay in English; German UI texts as specified.
