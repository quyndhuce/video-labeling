# Gemini Batch Caption Review Design

Date: 2026-07-08
Status: Implemented, revised 2026-07-09 (see Revisions below)

## Revisions (2026-07-09)

Post-ship feedback led to three changes to what's documented below:

1. **Full coverage, not just non-empty captions.** The preview now yields every object region in scope, whether or not it has a caption yet. Items with no existing `visual_caption` are still non-selectable/non-eligible for the Gemini run (unchanged goal — nothing to "fix" if there's nothing there), but they now show up in the table (grayed out, "no caption yet") instead of being silently absent, so a reviewer scanning one video can see every segment and every object in it. `_serialize_preview_item` adds `eligible`/`skip_reason`; the preview response adds `eligible_items`.
2. **Approve-before-write.** The "Per-item manual accept/reject after Gemini responds — out of scope" line below is superseded. `_run_batch_review` now only *proposes* changes (`results[].new`, `applied: false`); nothing is written to `db.captions` until a new `POST /api/annotations/batch-review/confirm` call (`{task_id, caption_ids}`) applies the selected proposals and flips their `applied` flag. The frontend results table gets a checkbox per successful row (checked by default) and a "Confirm & Apply Selected" button.
3. **Dialog theming.** The dialog's SCSS hardcoded light-mode colors that clashed with the app's dark theme; restyled to reuse the app's existing dark palette (`#1a1f2e` panels, `rgba(255,255,255,0.06)` borders, `#cbd5e1`/`#94a3b8` text, etc.).

## Revisions (2026-07-10)

4. **Generic type, not proper name, in the caption text.** `_build_review_prompt` previously told Gemini to insert `object_label` verbatim into the caption (e.g. "Hang Dau Tower is..."). Object labels are often proper names, but visual captions should describe what's visually apparent, not name-drop it. The prompt now asks Gemini to first infer the object's general type from its label (e.g. "Hang Dau Tower" -> "tower") and use that generic term in both the English and Vietnamese caption (e.g. "this tower...", "tòa tháp này..."), never the proper name itself. See the updated prompt template below.

## Goal

Let a reviewer batch-fix object-level visual captions that misidentify the object (e.g. caption says "This building is..." when the labeled object is actually a "gate"), using the object's own name and its segment's name as ground-truth hints, via the Gemini API. The corrected caption is translated to Vietnamese in the same pass. Before any Gemini call happens, the reviewer sees an exact JSON preview of what will be sent and approves it; only then do they paste a Gemini API key into a frontend input to run the batch.

## Scope

In scope:
- Object/region-level captions only (`captions` docs where `region_id` is set) — these are the only caption docs with a `visual_caption` / `visual_caption_vi` field. Segment-level captions (`region_id: null`) have no `visual_caption` field and are not touched.
- A synchronous preview endpoint that builds the full list of candidate items (names + current captions + exact Gemini prompt per item) with **no Gemini call and no API key required**.
- A frontend review UI: checkbox table of items (pre-selection all on) + raw JSON view, scoped to a project (optionally filtered to one video).
- An "Approve & Run" step that reveals a password-style API key input (not persisted anywhere) and a model dropdown, then kicks off a backend batch job.
- An async backend job (background thread + Mongo task doc, mirroring `export_tasks`) that calls Gemini per item, parses a strict-JSON response, and overwrites `visual_caption` + `visual_caption_vi` on success.
- Frontend polling of job progress and a results view (old vs. new caption per item, success/error).

Out of scope:
- Segment-level (`contextual_caption`/`knowledge_caption`/`combined_caption`) or region-level `combined_caption` review — only `visual_caption`/`visual_caption_vi` are touched.
- Per-item manual accept/reject *after* Gemini responds — a successful Gemini response is applied automatically (matches the user's requested replace-in-place behavior). Failed items are left untouched and reported as errors.
- Persisting the Gemini API key to Settings/DB for this feature — it is supplied fresh per run and used only for that job's lifetime.
- Undo/rollback UI for applied changes (same risk profile as the existing `caption_combiner` bulk-fix tool — no rollback exists there either).
- Running more than one batch-review job per project concurrently.
- Editing `knowledge_base_ids` or any KB linkage.

## Data model (existing, unchanged)

- `video_segments`: `name` (segment name), `video_id`, `order`, ...
- `object_regions`: `label` (object name), `segment_id`, `video_id`, ...
- `captions`: one doc per region (`region_id` set) with `visual_caption`, `visual_caption_vi`, plus other unrelated caption fields. Confirmed in `backend/routes/annotations.py:141-169` (`get_region_caption`) vs. `:109-138` (`get_segment_caption`, no visual_caption).

No schema changes to these collections — only `visual_caption`/`visual_caption_vi` values are overwritten, `updated_at` is stamped.

## Architecture

Backend-driven, two-phase, matching the existing async export pattern (`export_tasks` + `threading.Thread`, see `backend/routes/annotations.py:1920-1996`):

1. **Preview phase** — synchronous GET, pure DB read, builds the item list and the literal prompt text per item. No Gemini SDK involved yet.
2. **Apply phase** — POST starts a background job. Gemini calls happen server-side via `google.generativeai` (already a backend dependency, already used in `backend/routes/videos.py:337,502-503`), reusing the existing `_extract_json_from_text()` helper (`videos.py:125-157`) for resilient JSON parsing, and a retry/backoff scheme modeled on `tools/caption_combiner/src/caption_combiner/01_regenerate.py:226-289` (`MIN_REQUEST_DELAY_S=0.75` throttle, exponential backoff with jitter on rate-limit errors, `MAX_RETRIES=5`, `RETRY_MAX_DELAY=60s`, no retry on non-retryable 4xx other than 429).

Chosen over a frontend-direct-to-Gemini approach (like `gemini.service.ts`) because a project-wide batch can be large; a background job survives the browser tab closing and lets us reuse the codebase's existing retry/parsing logic instead of reimplementing it in TypeScript.

## Backend

### New file: `backend/routes/batch_review.py`

`annotations.py` is already 2000+ lines; this feature gets its own blueprint (`batch_review_bp`) rather than growing that file further. It's registered in `backend/app.py` with the same `url_prefix='/api/annotations'` as `annotations_bp` (Flask allows multiple blueprints to share a prefix as long as blueprint names and concrete route paths don't collide), so from the frontend's perspective the endpoints are indistinguishable from the rest of `/api/annotations/*`. It imports and reuses `_extract_json_from_text` (moved to a shared `backend/utils/` module if not already importable) and the `db.settings` lookup helpers used for `gemini_model`/`gemini_api_key` defaults in `videos.py`.

New Mongo collection: `caption_review_tasks`, shaped like:

```json
{
  "_id": "ObjectId",
  "project_id": "ObjectId",
  "video_id": "ObjectId or null",
  "status": "pending | running | completed | failed",
  "total": 0,
  "processed": 0,
  "succeeded": 0,
  "failed": 0,
  "error": null,
  "results": [
    {
      "caption_id": "...",
      "region_id": "...",
      "segment_name": "...",
      "object_label": "...",
      "video_name": "...",
      "old": { "visual_caption": "...", "visual_caption_vi": "..." },
      "new": { "visual_caption": "...", "visual_caption_vi": "..." },
      "status": "ok | error",
      "error": null
    }
  ],
  "created_by": "ObjectId",
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

### `GET /api/annotations/batch-review/preview`

Query params: `project_id` (required), `video_id` (optional, must belong to `project_id`).

Auth: `@token_required`, same as all annotations routes.

Logic:
1. Resolve target videos: `db.videos.find({'project_id': ObjectId(project_id)})`, filtered to `video_id` if given.
2. For each video, `db.video_segments.find({'video_id': v['_id']}).sort('order', 1)`.
3. For each segment, `db.object_regions.find({'segment_id': seg['_id']})`.
4. For each region, `db.captions.find_one({'region_id': region['_id']})`. **Skip** if no caption doc or `visual_caption` is empty/missing — nothing to review.
5. Build one item per remaining region using a shared helper `_build_review_prompt(object_label, segment_name, current_visual_caption)` (see prompt template below) — this exact string is what phase 2 will send, so the preview is a true preview.

Response:
```json
{
  "generated_at": "2026-07-08T12:00:00Z",
  "project_id": "...",
  "video_id": null,
  "total_items": 42,
  "items": [
    {
      "caption_id": "...",
      "region_id": "...",
      "segment_id": "...",
      "video_id": "...",
      "video_name": "...",
      "segment_name": "Segment 1 - gate",
      "object_label": "gate",
      "current_visual_caption": "This building is made of stone...",
      "current_visual_caption_vi": "Tòa nhà này được làm bằng đá...",
      "prompt": "<literal text that will be sent to Gemini>"
    }
  ]
}
```

No Gemini SDK import, no API key parameter — this endpoint cannot make an external call by construction.

### Prompt template (`_build_review_prompt`)

```
Object name (ground truth, may be a proper name): {object_label}
Segment name (context): {segment_name}
Original caption (may misidentify the object): {current_visual_caption}

Task:
1. Identify what general type of object "{object_label}" is (e.g. "Hang Dau Tower" -> "tower",
   "Ben Thanh Market" -> "market", "gate" -> "gate"). Rewrite the caption so it correctly refers
   to the object using that general type (e.g. "this tower", "the market") wherever the original
   wrongly called it something else. Do NOT insert the proper name itself into the caption —
   only the generic type. Preserve all other correctly-described visual details (colors,
   position, materials, actions, etc.). Keep it a natural, fluent English caption of similar
   length.
2. Translate your corrected caption into fluent Vietnamese with proper diacritics, using the
   generic type there too (e.g. "tòa tháp này", "ngôi chợ này") — not the proper name.

Return ONLY valid JSON:
{"visual_caption": "...", "visual_caption_vi": "..."}
```

### `POST /api/annotations/batch-review/apply`

Body:
```json
{
  "project_id": "...",
  "video_id": null,
  "item_ids": ["caption_id_1", "caption_id_2"],
  "gemini_api_key": "...",
  "gemini_model": "gemini-2.5-flash"
}
```

Validation (400 on failure, job never starts):
- `item_ids` non-empty.
- `gemini_api_key` non-empty.
- `gemini_model` defaults to the existing `gemini_model` Settings value (`db.settings`, same lookup as `videos.py:497-498`) if omitted.

Concurrency guard: reject with 409 if a `caption_review_tasks` doc for the same `project_id` already has `status` in `{pending, running}`.

On success: insert a `caption_review_tasks` doc (`status: pending`), spawn `threading.Thread(target=_run_batch_review, args=(app, task_id, item_ids, gemini_api_key, gemini_model))`, return `{"task_id": "..."}` (202).

`_run_batch_review` worker:
1. `genai.configure(api_key=gemini_api_key)`, `model = genai.GenerativeModel(gemini_model)`. Set task `status: running`.
2. For each `caption_id` in `item_ids`: re-fetch the caption + region + segment + video fresh from Mongo (data may have changed since preview), rebuild the prompt via the same `_build_review_prompt`, call Gemini with the retry/backoff scheme described above, parse via `_extract_json_from_text`.
   - **First-item auth short-circuit**: if the very first call fails with an auth/permission error (invalid key), abort the whole job immediately, set `status: failed`, `error: "Invalid Gemini API key"` — avoids burning through the full list with a bad key.
   - On parse success with both `visual_caption` and `visual_caption_vi` non-empty: `db.captions.update_one({'_id': caption_id}, {'$set': {'visual_caption': ..., 'visual_caption_vi': ..., 'updated_at': now}})`. Do **not** call `_reset_video_approval_if_needed` (i.e. behave like `skip_approval_reset=True`), matching the existing convention for bulk auto-fixes in `caption_combiner`. Append a `results` entry with `status: "ok"`, `old`/`new` values.
   - On any other failure (retries exhausted, malformed JSON, empty fields): leave the caption untouched, append a `results` entry with `status: "error"`, `error: "<reason>"`. Continue to the next item.
   - After each item, update `processed`/`succeeded`/`failed` counters and `updated_at` on the task doc so polling reflects live progress.
3. When the loop finishes, set `status: completed` (unless already `failed` from the auth short-circuit).

### `GET /api/annotations/batch-review/status/<task_id>`

Auth: `@token_required`. Returns the serialized task doc as-is (including the running `results` list) for polling.

## Frontend

### Entry point

New icon button in `project-detail.component.html`'s nav-title row (alongside the existing export buttons, `:16-30`), e.g. `matTooltip="Batch Review Visual Captions (Gemini)"`, opening a new `BatchCaptionReviewDialogComponent` (Angular Material dialog, same pattern as other project-detail dialogs) scoped to the current project.

### Dialog flow

1. **Scope**: project is fixed (from the page); an optional video `mat-select` narrows to one video. "Generate Preview" button.
2. **Preview**: calls `videoService.getBatchReviewPreview(projectId, videoId?)` → renders a table (checkbox | segment name | object name | current EN caption | current VI caption), all rows checked by default, plus a "View raw JSON" toggle showing the exact response (matches the existing metadata-only export's inspect-before-download UX). Row count and an empty-state ("no object captions found") are shown.
3. **Approve**: "Approve & Run" button (disabled if zero rows checked) reveals a password-type API key field (empty, never prefilled/persisted) and a model `mat-select` prefilled from the existing Settings `gemini_model` value. "Start" button calls `videoService.startBatchReview(projectId, videoId?, selectedCaptionIds, apiKey, model)`.
4. **Progress**: on receiving `{task_id}`, poll `videoService.getBatchReviewStatus(taskId)` every ~2s (same interval as existing export status polling) until `status` is `completed` or `failed`; show a progress bar (`processed`/`total`) and a live-updating results table.
5. **Results**: final table shows, per item, old vs. new EN/VI caption side by side with a success/error badge; a summary line ("38 succeeded, 4 failed"). Errored items keep their original caption untouched — reviewer can re-run the batch later (a re-run's preview will simply show the same unfixed items again, since the fix is a no-op on already-correct captions the second time it's judged correct).

### New service methods (`frontend/src/app/core/services/video.service.ts`, alongside the existing `ANNOTATIONS_API`-prefixed methods at `:200-232`)

```ts
getBatchReviewPreview(projectId: string, videoId?: string): Observable<BatchReviewPreview> {
  const url = `${this.ANNOTATIONS_API}/batch-review/preview?project_id=${projectId}`
    + (videoId ? `&video_id=${videoId}` : '');
  return this.http.get<BatchReviewPreview>(url);
}

startBatchReview(projectId: string, videoId: string | null, itemIds: string[], apiKey: string, model?: string): Observable<{ task_id: string }> {
  return this.http.post<{ task_id: string }>(`${this.ANNOTATIONS_API}/batch-review/apply`, {
    project_id: projectId, video_id: videoId, item_ids: itemIds, gemini_api_key: apiKey, gemini_model: model
  });
}

getBatchReviewStatus(taskId: string): Observable<BatchReviewTask> {
  return this.http.get<BatchReviewTask>(`${this.ANNOTATIONS_API}/batch-review/status/${taskId}`);
}
```

New TS interfaces (`frontend/src/app/core/models/index.ts`) mirroring the backend response/task shapes above (`BatchReviewItem`, `BatchReviewPreview`, `BatchReviewResult`, `BatchReviewTask`).

## Error handling

- Preview: 400 if `project_id` missing/invalid; empty `items` array (not an error) if no eligible object captions exist.
- Apply: 400 for missing `item_ids`/`gemini_api_key`; 409 if a job is already running for the project.
- Per-item Gemini failures never abort the job (except the first-item auth short-circuit) — they're reported in `results` and the caption is left untouched.
- Frontend: if status polling itself errors (network), show a retry affordance rather than losing the task id; the task doc in Mongo is the source of truth so refreshing the page and re-polling the same `task_id` would still work (task id kept in a local var, not persisted across reloads in v1 — acceptable since jobs are expected to run in well under a browser session).

## Security notes

- The Gemini API key is accepted in the `apply` POST body, held only in memory for the life of the background thread, and never written to `db.settings` or any other persistent store by this feature.
- The key does traverse the app's own backend (unlike the existing frontend-direct `gemini.service.ts` pattern) — acceptable since it's the same trust boundary as the rest of the authenticated API, and matches how `videos.py`'s existing Gemini pipeline already handles keys server-side.
