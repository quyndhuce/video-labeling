# Batch Review Task Visibility & Cancel — Design

**Date:** 2026-07-10
**Status:** Approved for planning

## Problem

Batch caption review jobs run as daemon threads with a status document in
`db.caption_review_tasks` (see `backend/routes/batch_review.py`). Today:

- There is no way to see a running task except by knowing its `task_id`
  (`GET /batch-review/status/<task_id>`), and no way to stop one.
- `POST /batch-review/apply` returns **409 "already running"** while any task
  for the project has status `pending`/`running`. If the Flask process
  restarts mid-run (or the thread dies without reaching its `except` handler),
  the Mongo doc stays `running` forever and batch review is permanently
  blocked for that project with nothing visible to kill.
- A running job cannot be stopped even when it is burning Gemini quota on
  hundreds of items the user no longer wants processed.

## Scope

Batch caption review tasks only (`db.caption_review_tasks`). Export tasks
(`db.export_tasks`) are out of scope. UI lives inside the existing batch
caption review dialog; no new page.

## Design

### 1. Task statuses

Two new **terminal** statuses join `completed` / `failed`:

| Status        | Meaning                                      | Set by            |
|---------------|----------------------------------------------|-------------------|
| `cancelled`   | User requested cancellation                  | Cancel endpoint   |
| `interrupted` | Task was `pending`/`running` at server boot  | Startup sweep     |

The 409 gate in `batch_review_apply` continues to match only
`{'status': {'$in': ['pending', 'running']}}`, so both new statuses unblock
new runs. The frontend treats them like `failed` for stopping polling.

### 2. Cancel endpoint

`POST /batch-review/cancel` — body `{"task_id": "..."}`, `@token_required`
(any authenticated user may cancel; the app has no role system).

One atomic update:

```python
res = db.caption_review_tasks.update_one(
    {'_id': task_id, 'status': {'$in': ['pending', 'running']}},
    {'$set': {'status': 'cancelled', 'updated_at': utcnow}}
)
```

- Matched → return the serialized task (now `cancelled`).
- Not matched, task exists → task already finished; return it unchanged
  (cancel is an idempotent no-op).
- Task not found → 404.

This works whether the worker thread is alive or dead: a dead task only
needs its doc flipped to clear the 409 gate.

### 3. Worker cooperation

In `_run_batch_review`:

- At the top of each item iteration, re-read the task's `status`
  (`find_one` projection on `status`); if `cancelled`, return immediately.
  The extra query is negligible next to a Gemini call.
- `_call_gemini_with_retry` also checks for cancellation between retry
  attempts (before each backoff sleep), so a task stuck in retry backoff
  responds within one attempt instead of after minutes.
- The final "mark completed" update guard changes from
  `{'status': {'$ne': 'failed'}}` to
  `{'status': {'$nin': ['failed', 'cancelled']}}` so a cancel landing after
  the last item is not overwritten to `completed`.

Results already pushed to the doc are kept: partially processed `ok` items
remain confirmable through the existing `/batch-review/confirm` flow.
Cancellation takes effect between items; an in-flight Gemini call completes
first (seconds).

### 4. Startup sweep

At app startup (in `app.py`, after the DB handle is created):

```python
db.caption_review_tasks.update_many(
    {'status': {'$in': ['pending', 'running']}},
    {'$set': {'status': 'interrupted', 'error': 'Server restarted',
              'updated_at': utcnow}}
)
```

A task still `pending`/`running` at boot provably has no thread (threads are
daemon threads of the previous process), so the sweep is always correct.

### 5. Active-task lookup

`GET /batch-review/active?project_id=X` — `@token_required`. Response is
always `{"task": ...}`: the value is the project's `pending`/`running` task
(serialized exactly as the status endpoint serializes one) or `null` when
none is running. `project_id` is required → 400 when missing.

### 6. Frontend (batch caption review dialog)

- **On open:** call the active lookup. If a task is running, jump straight
  to the progress view and re-attach: start the existing 2-second polling,
  show progress bar, counts, and streaming results.
- **Cancel button:** visible while task status is `pending`/`running`;
  calls the cancel endpoint and continues polling until a terminal status
  arrives.
- **Apply 409:** instead of a dead-end error, attach to the `task_id`
  already included in the 409 response body and start polling (with Cancel
  available).
- **Terminal states:** `completed`, `failed`, `cancelled`, `interrupted`
  all stop polling. A `cancelled`/`interrupted` task shows its partial
  results with the normal confirm/apply step for `ok` items.
- `video.service.ts` gains `getActiveBatchReview(projectId)` and
  `cancelBatchReview(taskId)`.

## Error handling summary

| Case                                      | Behavior                          |
|-------------------------------------------|-----------------------------------|
| Cancel unknown `task_id`                  | 404                               |
| Cancel finished task                      | No-op, returns task as-is         |
| Cancel stuck task (no thread)             | Doc flips; 409 gate clears        |
| Cancel while worker mid-Gemini-call       | Takes effect at next item/retry   |
| Server restart with running task          | Sweep marks it `interrupted`      |
| Cancel races final completion update      | `$nin` guard keeps `cancelled`    |

## Testing

Exercised end-to-end through the API:

1. Start a review over many items; cancel mid-run; verify status flips to
   `cancelled`, the worker stops (no further `processed` growth), and
   partial `ok` results are confirmable.
2. Verify a new `apply` succeeds immediately after cancel (409 cleared).
3. Simulate a stuck task (insert a `running` doc with no thread): verify
   cancel clears it, and separately that a server restart sweeps it to
   `interrupted`.
4. Dialog: open while a task runs → re-attaches with progress + Cancel;
   apply during a running task → attaches instead of erroring.

## Out of scope

- Export task listing/cancelation.
- Task history UI on the project page.
- Hard-killing threads (unsafe in Python; unnecessary given cooperation).
- Roles/permissions for who may cancel.
