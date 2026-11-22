# @metis/work-delivery

A built-in DSH sidebar plugin that brings the read-first **Work & Delivery Hub** (`工作与交付`) directly into each digital employee's DSH workspace:

- **LLM-First Creation (Zero Duplicate Tools)**: Leverages existing sandbox base skills (`sandbox-expose`, `sandbox-cron`, `sandbox-service` in `sandbox-services/SKILL.md`) and `sandbox-mesh` (`mesh_dispatch_tasks`, `mesh_request_approval`) so users simply ask the AI in chat to publish pages, add schedules, start services, or manage tasks. Adds only 2 lightweight, non-overlapping tools (`delivery_overview`, `delivery_task_create`).
- **Observer-First UI Optimized for Scale**: Top KPI summary bar, live search, task status filters, expandable compact rows, and "Load more" pagination for large lists — keeping only lightweight human actions (Open page, Approve/Reject, Start/Stop/Logs, Remove).

## Build & Test

```sh
cd plugins/work-delivery
node scripts/build.mjs
node .test/run.mjs
```
