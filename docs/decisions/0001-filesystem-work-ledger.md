# ADR-0001: Adopt a filesystem work ledger with sortable filenames

Status: Accepted by the user on 2026-11-04.

## Context

The README accumulated development notes and a pasted test file. Work state and evidence need durable, navigable records outside the introduction. The user requested the linked Agent Work Ledger design, modified so work filenames sort sensibly.

## Decision

Use the [ledger workflow](../work-ledger.md), a root [PLAN.md](../../PLAN.md) index, task/bug state directories, individual plans/milestones, ADRs, and dated session handoffs. All task, bug, plan, decision, and milestone filenames begin with a four-digit numeric prefix; numbers are immutable and unique per type across states. Notes begin with YYYY-MM-DD. Keep README concise and maintain reference documentation separately.

## Consequences

Work and its evidence can be reviewed in Git and resumed without chat history. Moving files requires updating links. Agents must coordinate number allocation and claims. There is no new runtime dependency, automatic orchestration, or synchronization with the live CC Board. Existing operational safeguards in AGENTS.md remain in force.
