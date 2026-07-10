# Batch Review Task Visibility & Cancel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users see the running batch caption review task for a project and cancel it — including "stuck" tasks whose worker thread is dead — from inside the batch caption review dialog.

**Architecture:** Cooperative cancellation via the existing Mongo status doc (`db.caption_review_tasks`). A new `POST /batch-review/cancel` endpoint atomically flips `pending`/`running` → `cancelled`; the worker thread re-reads status between items (and between retry sleeps) and exits when it sees `cancelled`. A startup sweep marks orphaned `pending`/`running` docs as `interrupted` so they stop blocking the 409 gate. A new `GET /batch-review/active` endpoint lets the dialog re-attach to a running task on open. Spec: `docs/superpowers/specs/2026-07-10-batch-review-task-cancel-design.md`.

**Tech Stack:** Flask + PyMongo backend (`backend/routes/batch_review.py`, `backend/app.py`), Angular 17 standalone-component frontend (Material dialog).

**Testing note:** This repo has no pytest/karma infrastructure. Following the pattern of `docs/superpowers/plans/2026-07-08-gemini-batch-caption-review.md`, each backend task is verified with `python -m py_compile` plus curl against the running dev server (port 6800), and frontend tasks with `ng build` plus a scripted manual check. Run all commands in WSL bash from the repo root (`/home/luna/video-labeling`).

**Two statuses added (terminal, like `completed`/`failed`):**
- `cancelled` — user requested cancellation via the cancel endpoint
- `interrupted` — task was `pending`/`running` at server boot (startup sweep)

The 409 gate in `batch_review_apply` (`backend/routes/batch_review.py:416-424`) already matches only `{'status': {'$in': ['pending', 'running']}}` and needs **no change** — both new statuses unblock it automatically.

---

### Task 1: Worker cooperation — cancellation checks in `_run_batch_review`

**Files:**
- Modify: `backend/routes/batch_review.py` (helper after `_serialize_task` ~line 236; `_call_gemini_with_retry` ~line 239; `_run_batch_review` loop ~line 291; completion update ~line 382)

- [ ] **Step 1: Add the `_task_cancelled` helper**

Insert directly after the `_serialize_task` function (after its closing `}` around line 236):

```python
def _task_cancelled(db, task_id):
    """True if the task doc has been flipped to 'cancelled' by the cancel
    endpoint. The worker polls this between items and between retry sleeps."""
    doc = db.caption_review_tasks.find_one({'_id': task_id}, {'status': 1})
    return bool(doc) and doc.get('status') == 'cancelled'
```

- [ ] **Step 2: Thread cancellation through `_call_gemini_with_retry`**

Replace the whole function (currently `def _call_gemini_with_retry(model, prompt, caption_id):` ~line 239) with:

```python
def _call_gemini_with_retry(model, prompt, caption_id, db, task_id):
    """Call Gemini with a minimum request delay + exponential backoff on rate
    limits, mirroring tools/caption_combiner's call_gpt_with_retry.

    Returns (text, is_auth_error). text is None if every retry failed, the
    error was non-retryable, or the task was cancelled mid-retry;
    is_auth_error is True for an invalid/rejected key.
    """
    time.sleep(MIN_REQUEST_DELAY_S)

    for attempt in range(MAX_RETRIES):
        try:
            response = model.generate_content(prompt)
            return (getattr(response, 'text', '') or '').strip(), False
        except Exception as e:
            message = str(e)
            upper = message.upper()
            is_auth_error = (
                'API_KEY_INVALID' in upper or 'PERMISSION_DENIED' in upper
                or 'UNAUTHENTICATED' in upper or ' 401' in message or ' 403' in message
            )
            if is_auth_error:
                return None, True

            # Don't sit in a long backoff sleep for a task the user has
            # already cancelled — bail out before sleeping.
            if _task_cancelled(db, task_id):
                logger.info(f"[BatchReview] task {task_id} cancelled during retries for {caption_id}")
                return None, False

            is_rate_limited = '429' in message or 'RATE_LIMIT' in upper or 'RESOURCE_EXHAUSTED' in upper
            if is_rate_limited:
                delay = min(RETRY_BASE_DELAY * (2 ** attempt) + random.uniform(0, 1), RETRY_MAX_DELAY)
                logger.info(f"[BatchReview] rate limited on {caption_id}, attempt {attempt + 1}/{MAX_RETRIES}, sleeping {delay:.1f}s")
                time.sleep(delay)
                continue

            delay = min(RETRY_BASE_DELAY * (2 ** attempt), RETRY_MAX_DELAY)
            logger.info(f"[BatchReview] error on {caption_id}: {message} — attempt {attempt + 1}/{MAX_RETRIES}, sleeping {delay:.1f}s")
            time.sleep(delay)

    logger.error(f"[BatchReview] exhausted {MAX_RETRIES} retries for {caption_id}")
    return None, False
```

- [ ] **Step 3: Check for cancellation at the top of each item iteration**

In `_run_batch_review`, the loop currently starts (~line 291):

```python
            for index, caption_id in enumerate(item_ids):
                try:
                    caption = db.captions.find_one({'_id': ObjectId(caption_id)})
```

Change to:

```python
            for index, caption_id in enumerate(item_ids):
                if _task_cancelled(db, task_id):
                    logger.info(f"[BatchReview] task {task_id} cancelled after {index} of {len(item_ids)} items")
                    return

                try:
                    caption = db.captions.find_one({'_id': ObjectId(caption_id)})
```

(The doc keeps its already-pushed `results`, so partially processed `ok`
items stay confirmable via `/batch-review/confirm`.)

- [ ] **Step 4: Update the `_call_gemini_with_retry` call site**

Inside the same loop (~line 339), change:

```python
                    text, is_auth_error = _call_gemini_with_retry(model, prompt, caption_id)
```

to:

```python
                    text, is_auth_error = _call_gemini_with_retry(model, prompt, caption_id, db, task_id)
```

- [ ] **Step 5: Guard the final completion update against a late cancel**

At the end of the loop (~line 382), change:

```python
            db.caption_review_tasks.update_one(
                {'_id': task_id, 'status': {'$ne': 'failed'}},
                {'$set': {'status': 'completed', 'updated_at': datetime.now(timezone.utc)}}
            )
```

to:

```python
            db.caption_review_tasks.update_one(
                {'_id': task_id, 'status': {'$nin': ['failed', 'cancelled']}},
                {'$set': {'status': 'completed', 'updated_at': datetime.now(timezone.utc)}}
            )
```

- [ ] **Step 6: Syntax check**

Run: `backend/venv/bin/python -m py_compile backend/routes/batch_review.py && echo OK`
Expected: `OK`

- [ ] **Step 7: Commit**

```bash
git add backend/routes/batch_review.py
git commit -m "feat: cooperative cancellation checks in batch review worker"
```

---

### Task 2: `POST /batch-review/cancel` endpoint

**Files:**
- Modify: `backend/routes/batch_review.py` (insert after `batch_review_status`, i.e. after its `return jsonify(_serialize_task(task)), 200` ~line 460, before `batch_review_confirm`)

- [ ] **Step 1: Add the endpoint**

```python
@batch_review_bp.route('/batch-review/cancel', methods=['POST'])
@token_required
def batch_review_cancel():
    """Flip a pending/running task to 'cancelled'.

    Works whether or not the worker thread is still alive: a live worker
    exits at its next check (Task 1); a dead/stuck task only needs the doc
    flipped so the 409 gate in batch_review_apply stops matching it.
    Cancelling an already-finished task is an idempotent no-op.
    """
    data = request.get_json() or {}
    task_id = data.get('task_id')
    if not task_id:
        return jsonify({'error': 'task_id is required'}), 400

    db = current_app.db
    db.caption_review_tasks.update_one(
        {'_id': task_id, 'status': {'$in': ['pending', 'running']}},
        {'$set': {'status': 'cancelled', 'updated_at': datetime.now(timezone.utc)}}
    )

    task = db.caption_review_tasks.find_one({'_id': task_id})
    if not task:
        return jsonify({'error': 'Task not found'}), 404
    return jsonify(_serialize_task(task)), 200
```

- [ ] **Step 2: Syntax check**

Run: `backend/venv/bin/python -m py_compile backend/routes/batch_review.py && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/routes/batch_review.py
git commit -m "feat: add batch review cancel endpoint"
```

---

### Task 3: `GET /batch-review/active` endpoint

**Files:**
- Modify: `backend/routes/batch_review.py` (insert directly after the new `batch_review_cancel` from Task 2)

- [ ] **Step 1: Add the endpoint**

Response is always `{"task": ...}` — the project's `pending`/`running` task
serialized like the status endpoint, or `null` when none is running.

```python
@batch_review_bp.route('/batch-review/active', methods=['GET'])
@token_required
def batch_review_active():
    """Return the project's currently pending/running task, or null."""
    project_id = request.args.get('project_id')
    if not project_id:
        return jsonify({'error': 'project_id is required'}), 400

    task = current_app.db.caption_review_tasks.find_one({
        'project_id': project_id,
        'status': {'$in': ['pending', 'running']},
    })
    return jsonify({'task': _serialize_task(task) if task else None}), 200
```

- [ ] **Step 2: Syntax check**

Run: `backend/venv/bin/python -m py_compile backend/routes/batch_review.py && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/routes/batch_review.py
git commit -m "feat: add batch review active-task lookup endpoint"
```

---

### Task 4: Startup sweep for orphaned tasks

**Files:**
- Modify: `backend/app.py` (import at top; sweep after `app.db = client[Config.DB_NAME]` ~line 54)

- [ ] **Step 1: Add the datetime import**

At the top of `backend/app.py`, after `import os` (line 5), add:

```python
from datetime import datetime, timezone
```

- [ ] **Step 2: Add the sweep**

In `create_app()`, directly after these existing lines (~lines 53-55):

```python
    client = MongoClient(Config.MONGO_URI)
    app.db = client[Config.DB_NAME]
    init_vector_store(app.db)
```

add:

```python
    # Any batch review task still pending/running at boot has no worker
    # thread (workers are daemon threads of the previous process) — mark it
    # interrupted so it stops blocking new runs via the 409 gate.
    app.db.caption_review_tasks.update_many(
        {'status': {'$in': ['pending', 'running']}},
        {'$set': {
            'status': 'interrupted',
            'error': 'Server restarted',
            'updated_at': datetime.now(timezone.utc),
        }}
    )
```

- [ ] **Step 3: Syntax check**

Run: `backend/venv/bin/python -m py_compile backend/app.py && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app.py
git commit -m "feat: sweep orphaned batch review tasks to interrupted at startup"
```

---

### Task 5: Backend end-to-end verification

**Files:** none (verification only). Requires the dev backend running and Mongo reachable.

- [ ] **Step 1: Find the DB name and start the backend**

```bash
grep -E 'DB_NAME|MONGO_URI' backend/config.py
cd backend && venv/bin/python app.py   # serves on http://localhost:6800
```

Note the `DB_NAME` value — the mongosh commands below use `$DB_NAME`.

- [ ] **Step 2: Get an auth token and a project id**

Login returns `{"token": ...}` (`backend/routes/auth.py:79-80`). In a second terminal:

```bash
TOKEN=$(curl -s -X POST http://localhost:6800/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"<your-username>","password":"<your-password>"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')
PROJECT_ID=<a real project id from the UI or db.projects>
```

- [ ] **Step 3: Verify stuck-task cancel (no thread exists)**

Insert a fake `running` doc, confirm it blocks apply, cancel it, confirm unblocked:

```bash
mongosh $DB_NAME --eval "db.caption_review_tasks.insertOne({_id: 'stuck-test', project_id: '$PROJECT_ID', video_id: null, status: 'running', total: 5, processed: 2, succeeded: 2, failed: 0, error: null, results: [], created_at: new Date(), updated_at: new Date()})"

# Active lookup sees it:
curl -s "http://localhost:6800/api/annotations/batch-review/active?project_id=$PROJECT_ID" -H "Authorization: Bearer $TOKEN"
# Expected: {"task": {"task_id": "stuck-test", "status": "running", ...}}

# Apply is blocked (409):
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:6800/api/annotations/batch-review/apply \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"project_id\":\"$PROJECT_ID\",\"item_ids\":[\"000000000000000000000000\"],\"gemini_api_key\":\"x\"}"
# Expected: 409

# Cancel it:
curl -s -X POST http://localhost:6800/api/annotations/batch-review/cancel \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"task_id": "stuck-test"}'
# Expected: {..., "status": "cancelled", ...}

# Active lookup is now clear:
curl -s "http://localhost:6800/api/annotations/batch-review/active?project_id=$PROJECT_ID" -H "Authorization: Bearer $TOKEN"
# Expected: {"task": null}
```

- [ ] **Step 4: Verify cancel edge cases**

```bash
# Unknown task -> 404
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:6800/api/annotations/batch-review/cancel \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"task_id": "does-not-exist"}'
# Expected: 404

# Cancelling the already-cancelled task again -> 200, still "cancelled" (idempotent)
curl -s -X POST http://localhost:6800/api/annotations/batch-review/cancel \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"task_id": "stuck-test"}'
# Expected: {..., "status": "cancelled", ...}
```

- [ ] **Step 5: Verify the startup sweep**

```bash
mongosh $DB_NAME --eval "db.caption_review_tasks.insertOne({_id: 'sweep-test', project_id: '$PROJECT_ID', status: 'running', total: 1, processed: 0, succeeded: 0, failed: 0, error: null, results: [], created_at: new Date(), updated_at: new Date()})"
# Restart the backend (Ctrl-C the app.py terminal, start it again), then:
mongosh $DB_NAME --eval "db.caption_review_tasks.findOne({_id: 'sweep-test'})"
# Expected: status: 'interrupted', error: 'Server restarted'
```

- [ ] **Step 6: Verify live-worker cancellation (real Gemini run)**

Using a real Gemini API key and a project with several eligible captions:
start a review from the dialog (or via curl to `/batch-review/apply` with
real `item_ids` from `/batch-review/preview`), then while it runs:

```bash
TASK_ID=<task_id returned by apply>
curl -s -X POST http://localhost:6800/api/annotations/batch-review/cancel \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"task_id\": \"$TASK_ID\"}"
sleep 5
curl -s "http://localhost:6800/api/annotations/batch-review/status/$TASK_ID" -H "Authorization: Bearer $TOKEN"
# Expected: status stays "cancelled"; "processed" stops growing (at most one
# more item finishes); backend log shows "[BatchReview] task ... cancelled after N of M items".
# Results already in the doc keep status "ok" and remain confirmable.
```

- [ ] **Step 7: Clean up test docs**

```bash
mongosh $DB_NAME --eval "db.caption_review_tasks.deleteMany({_id: {\$in: ['stuck-test', 'sweep-test']}})"
```

No commit — verification only.

---

### Task 6: Frontend model + service methods

**Files:**
- Modify: `frontend/src/app/core/models/index.ts:220` (`BatchReviewTask.status` union)
- Modify: `frontend/src/app/core/services/video.service.ts` (after `confirmBatchReview`, ~line 275)

- [ ] **Step 1: Extend the status union**

In `frontend/src/app/core/models/index.ts` line 220, change:

```typescript
  status: 'pending' | 'running' | 'completed' | 'failed';
```

to:

```typescript
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
```

- [ ] **Step 2: Add service methods**

In `frontend/src/app/core/services/video.service.ts`, directly after the
`confirmBatchReview` method (its closing `}` ~line 275), add:

```typescript
  getActiveBatchReview(projectId: string): Observable<{ task: BatchReviewTask | null }> {
    return this.http.get<{ task: BatchReviewTask | null }>(
      `${this.ANNOTATIONS_API}/batch-review/active?project_id=${projectId}`
    );
  }

  cancelBatchReview(taskId: string): Observable<BatchReviewTask> {
    return this.http.post<BatchReviewTask>(`${this.ANNOTATIONS_API}/batch-review/cancel`, {
      task_id: taskId,
    });
  }
```

- [ ] **Step 3: Build check**

Run: `cd frontend && npm run build`
Expected: build completes with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/core/models/index.ts frontend/src/app/core/services/video.service.ts
git commit -m "feat: add cancel/active batch review service methods and statuses"
```

---

### Task 7: Dialog logic — re-attach on open, 409 attach, cancel, terminal states

**Files:**
- Modify: `frontend/src/app/pages/project-detail/batch-caption-review-dialog/batch-caption-review-dialog.component.ts`

- [ ] **Step 1: Implement `OnInit` and add state**

Change the first import line from:

```typescript
import { Component, Inject, OnDestroy } from '@angular/core';
```

to:

```typescript
import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
```

Change the class declaration from:

```typescript
export class BatchCaptionReviewDialogComponent implements OnDestroy {
```

to:

```typescript
export class BatchCaptionReviewDialogComponent implements OnInit, OnDestroy {
```

Next to the existing `confirming = false;` field (~line 54), add:

```typescript
  cancelling = false;
```

- [ ] **Step 2: Re-attach to a running task on open**

Add after the constructor:

```typescript
  ngOnInit(): void {
    // If a batch review is already running for this project, re-attach to it
    // instead of showing the setup step.
    this.videoService.getActiveBatchReview(this.data.projectId).subscribe({
      next: (res) => {
        if (res.task) this.attachToTask(res.task.task_id);
      },
      error: () => { /* non-fatal: stay on the setup step */ }
    });
  }

  private attachToTask(taskId: string): void {
    this.step = 'running';
    this.pollingSub?.unsubscribe();
    this.pollingSub = interval(2000).subscribe(() => this.pollStatus(taskId));
    this.pollStatus(taskId);
  }
```

- [ ] **Step 3: Use `attachToTask` in `startReview` and attach on 409**

Replace the `subscribe({...})` handlers inside `startReview` (currently lines 160-169) with:

```typescript
      next: (res) => {
        this.starting = false;
        this.attachToTask(res.task_id);
      },
      error: (err) => {
        this.starting = false;
        if (err.status === 409 && err.error?.task_id) {
          this.snackBar.open('A review is already running — showing its progress', 'Close', { duration: 3000 });
          this.attachToTask(err.error.task_id);
        } else {
          this.snackBar.open('Failed to start review: ' + err.message, 'Close', { duration: 4000 });
        }
      }
```

(`err` is Angular's `HttpErrorResponse`: `err.status` is the HTTP code and
`err.error` is the parsed 409 body, which includes `task_id` —
`backend/routes/batch_review.py:421-424`.)

- [ ] **Step 4: Treat all four terminal statuses as done**

Replace the body of `pollStatus` (currently lines 173-193) with:

```typescript
  private static readonly TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'interrupted'];

  private pollStatus(taskId: string): void {
    this.videoService.getBatchReviewStatus(taskId).subscribe({
      next: (task) => {
        const terminal = BatchCaptionReviewDialogComponent.TERMINAL_STATUSES;
        const wasRunning = !terminal.includes(this.task?.status ?? '');
        this.task = task;
        if (terminal.includes(task.status)) {
          this.pollingSub?.unsubscribe();
          this.step = 'done';
          if (wasRunning) {
            this.confirmSelected = new Set(
              task.results.filter(r => r.status === 'ok' && !r.applied).map(r => r.caption_id)
            );
          }
        }
      },
      error: (err) => {
        this.pollingSub?.unsubscribe();
        this.snackBar.open('Lost connection to review job: ' + err.message, 'Close', { duration: 4000 });
      }
    });
  }
```

(Note: `TERMINAL_STATUSES` is a static class field — place it inside the class,
directly above `pollStatus`.)

- [ ] **Step 5: Add the cancel action**

Add after `pollStatus`:

```typescript
  cancelReview(): void {
    if (!this.task || this.cancelling) return;
    this.cancelling = true;
    this.videoService.cancelBatchReview(this.task.task_id).subscribe({
      next: () => {
        // The 2s poll picks up the 'cancelled' status and moves to 'done'.
        this.cancelling = false;
      },
      error: (err) => {
        this.cancelling = false;
        this.snackBar.open('Failed to cancel: ' + err.message, 'Close', { duration: 4000 });
      }
    });
  }
```

- [ ] **Step 6: Build check**

Run: `cd frontend && npm run build`
Expected: build completes with no TypeScript errors. (The template isn't
changed yet; nothing references `cancelReview` until Task 8.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/pages/project-detail/batch-caption-review-dialog/batch-caption-review-dialog.component.ts
git commit -m "feat: dialog re-attaches to running batch review and can cancel it"
```

---

### Task 8: Dialog template — Cancel button and cancelled/interrupted banners

**Files:**
- Modify: `frontend/src/app/pages/project-detail/batch-caption-review-dialog/batch-caption-review-dialog.component.html` (running/done block, lines 115-122)

- [ ] **Step 1: Add Cancel button and status banners**

The block currently reads (lines 115-122):

```html
  <ng-container *ngIf="step === 'running' || step === 'done'">
    <p *ngIf="task">{{ task.processed }} / {{ task.total }} processed &mdash; {{ task.succeeded }} succeeded, {{ task.failed }} failed</p>
    <mat-progress-bar *ngIf="step === 'running'" mode="determinate" [value]="task && task.total ? (task.processed / task.total * 100) : 0"></mat-progress-bar>
    <p *ngIf="task?.status === 'failed' && task?.error" class="error-banner">{{ task?.error }}</p>

    <p *ngIf="step === 'done' && task && task.succeeded > 0" class="confirm-hint">
      Review the proposed changes below and choose which ones to apply. Nothing is written to the actual captions until you confirm.
    </p>
```

Replace with:

```html
  <ng-container *ngIf="step === 'running' || step === 'done'">
    <p *ngIf="task">{{ task.processed }} / {{ task.total }} processed &mdash; {{ task.succeeded }} succeeded, {{ task.failed }} failed</p>
    <mat-progress-bar *ngIf="step === 'running'" mode="determinate" [value]="task && task.total ? (task.processed / task.total * 100) : 0"></mat-progress-bar>
    <p *ngIf="task?.status === 'failed' && task?.error" class="error-banner">{{ task?.error }}</p>
    <p *ngIf="task?.status === 'cancelled'" class="error-banner">
      Review cancelled &mdash; {{ task?.processed }} of {{ task?.total }} item(s) were processed before stopping.
    </p>
    <p *ngIf="task?.status === 'interrupted'" class="error-banner">
      Review was interrupted by a server restart. Partial results are shown below.
    </p>

    <div class="cancel-row" *ngIf="step === 'running' && task && (task.status === 'pending' || task.status === 'running')">
      <button mat-stroked-button color="warn" (click)="cancelReview()" [disabled]="cancelling">
        {{ cancelling ? 'Cancelling...' : 'Cancel Review' }}
      </button>
    </div>

    <p *ngIf="step === 'done' && task && task.succeeded > 0" class="confirm-hint">
      Review the proposed changes below and choose which ones to apply. Nothing is written to the actual captions until you confirm.
    </p>
```

(The rest of the block — results table, confirm row — is unchanged. The
existing confirm flow already shows partial `ok` results for a cancelled
task because `step` becomes `'done'`.)

- [ ] **Step 2: Add minimal styling for the cancel row**

In `frontend/src/app/pages/project-detail/batch-caption-review-dialog/batch-caption-review-dialog.component.scss`, append:

```scss
.cancel-row {
  margin: 12px 0;
  display: flex;
  justify-content: flex-end;
}
```

- [ ] **Step 3: Build check**

Run: `cd frontend && npm run build`
Expected: build completes with no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/pages/project-detail/batch-caption-review-dialog/batch-caption-review-dialog.component.html \
        frontend/src/app/pages/project-detail/batch-caption-review-dialog/batch-caption-review-dialog.component.scss
git commit -m "feat: cancel button and cancelled/interrupted banners in batch review dialog"
```

---

### Task 9: Frontend end-to-end verification

**Files:** none (verification only). Requires backend (port 6800) and `cd frontend && npm start` running, plus a real Gemini API key.

- [ ] **Step 1: Cancel a live run from the dialog**

1. Open the batch caption review dialog for a project with several eligible captions.
2. Generate preview, enter the API key, start the review.
3. While the progress bar advances, click **Cancel Review**.
4. Expected: button shows "Cancelling...", then within ~2-4s the dialog
   switches to the done step with the "Review cancelled — N of M item(s)
   were processed" banner. Already-processed `ok` items show checkboxes and
   can be confirmed & applied.

- [ ] **Step 2: Re-attach on open**

1. Start another review, close the dialog mid-run (X button).
2. Re-open the dialog for the same project.
3. Expected: it skips setup and shows the running progress view with the
   Cancel button, continuing to update.

- [ ] **Step 3: Apply-while-running attaches instead of erroring**

1. With a review running, open the dialog in a second browser tab, generate
   a preview, and click start.
2. Expected: snackbar "A review is already running — showing its progress"
   and the tab attaches to the running task instead of showing a dead-end
   409 error.

- [ ] **Step 4: Interrupted banner**

1. Start a review; while it runs, restart the Flask backend.
2. Re-open the dialog (or let polling continue).
3. Expected: task shows as `interrupted` with the "interrupted by a server
   restart" banner; a new review can be started immediately.

No commit — verification only.
