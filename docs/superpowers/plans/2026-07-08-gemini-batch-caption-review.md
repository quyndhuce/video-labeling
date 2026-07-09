# Gemini Batch Caption Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a reviewer batch-fix object-level visual captions that misidentify the labeled object (e.g. "This building is..." when the object is actually a "gate"), using the object's name and segment name as ground truth, translate the fix to Vietnamese, preview the exact Gemini payload before anything is sent, then run it after pasting a Gemini API key into a frontend input.

**Architecture:** Backend-driven, two-phase. A synchronous `GET .../batch-review/preview` endpoint builds the item list and the literal Gemini prompt per item with no API key and no external call. A `POST .../batch-review/apply` endpoint starts a background thread (mirroring the existing `export_tasks` pattern) that calls Gemini server-side, writes corrected captions back to Mongo, and exposes progress via `GET .../batch-review/status/<task_id>` polling.

**Tech Stack:** Flask + PyMongo + `google-generativeai` (backend), Angular 17 + Angular Material + RxJS (frontend).

**Spec:** `docs/superpowers/specs/2026-07-08-gemini-batch-caption-review-design.md`

**Testing note:** This codebase has no automated test suite for the backend (no pytest, no `tests/` directory) or for feature routes on the frontend (no relevant `.spec.ts` files, no test script in `package.json`). Introducing a new test framework as a side effect of this feature would be its own unrelated project, so each task below is verified manually instead — via `curl` against the running Flask dev server for backend tasks, and via `npm run build` (TypeScript/template compile check) plus a browser click-through for frontend tasks. This matches how every other feature in this codebase (exports, KB, settings) has been verified.

**Before you start:** Two terminals.
- Terminal A (backend): `cd backend && python app.py` — serves `http://localhost:6800`.
- Terminal B (frontend, only needed from Task 4 onward): `cd frontend && npm start` — serves `http://localhost:4200`, proxies `/api/*` to the backend.

For backend `curl` verification you need a JWT. Get one once and reuse it:
```bash
curl -s -X POST http://localhost:6800/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"<your-username>","password":"<your-password>"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])"
```
Export it as `TOKEN` in your shell for the rest of this plan: `export TOKEN=<paste>`. Also export a real `PROJECT_ID` you can query (any project that has at least one video with a segmented object and a visual caption filled in): `export PROJECT_ID=<paste>`.

---

### Task 1: Backend — preview endpoint (no Gemini call)

**Files:**
- Create: `backend/routes/batch_review.py`
- Modify: `backend/app.py:61-84` (register new blueprint)

- [ ] **Step 1: Create the blueprint file with the prompt builder, candidate iterator, and preview endpoint**

Create `backend/routes/batch_review.py`:

```python
from flask import Blueprint, request, jsonify, current_app
from datetime import datetime, timezone
from bson import ObjectId
import json
import logging
import random
import threading
import time
import uuid

from utils.auth_middleware import token_required
from routes.settings import _get_setting_value

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

batch_review_bp = Blueprint('batch_review', __name__)

MIN_REQUEST_DELAY_S = 0.75
MAX_RETRIES = 5
RETRY_BASE_DELAY = 2.0
RETRY_MAX_DELAY = 60.0


def _extract_json_from_text(text):
    """Try to parse a JSON object out of a Gemini text response.

    Same resilient parsing as backend/routes/videos.py:_extract_json_from_text
    (raw JSON, fenced ```json blocks, or best-effort brace-matched substring).
    """
    if not text:
        return None

    raw = text.strip()
    try:
        return json.loads(raw)
    except Exception:
        pass

    if '```' in raw:
        parts = raw.split('```')
        for part in parts:
            candidate = part.replace('json', '', 1).strip()
            if not candidate:
                continue
            try:
                return json.loads(candidate)
            except Exception:
                continue

    start = raw.find('{')
    end = raw.rfind('}')
    if start != -1 and end != -1 and end > start:
        candidate = raw[start:end + 1]
        try:
            return json.loads(candidate)
        except Exception:
            return None
    return None


def _build_review_prompt(object_label, segment_name, current_visual_caption):
    return f"""Object name (ground truth): {object_label}
Segment name (context): {segment_name}
Original caption (may misidentify the object): {current_visual_caption}

Task:
1. Rewrite the caption so it correctly refers to the object as "{object_label}" wherever the
   original wrongly called it something else, preserving all other correctly-described visual
   details (colors, position, materials, actions, etc.). Keep it a natural, fluent English
   caption of similar length.
2. Translate your corrected caption into fluent Vietnamese with proper diacritics.

Return ONLY valid JSON:
{{"visual_caption": "...", "visual_caption_vi": "..."}}
"""


def _iter_review_candidates(db, project_id, video_id=None):
    """Yield (video, segment, region, caption) for every object-level caption
    in the project that has a non-empty visual_caption. Segment-level captions
    (region_id: None) have no visual_caption field and are never yielded."""
    query = {'project_id': ObjectId(project_id)}
    if video_id:
        query['_id'] = ObjectId(video_id)
    videos = list(db.videos.find(query))

    for video in videos:
        segments = list(db.video_segments.find({'video_id': video['_id']}).sort('order', 1))
        for segment in segments:
            regions = list(db.object_regions.find({'segment_id': segment['_id']}))
            for region in regions:
                caption = db.captions.find_one({'region_id': region['_id']})
                if not caption or not (caption.get('visual_caption') or '').strip():
                    continue
                yield video, segment, region, caption


def _serialize_preview_item(video, segment, region, caption):
    visual_caption = caption.get('visual_caption', '')
    segment_name = segment.get('name', '')
    object_label = region.get('label', '')
    return {
        'caption_id': str(caption['_id']),
        'region_id': str(region['_id']),
        'segment_id': str(segment['_id']),
        'video_id': str(video['_id']),
        'video_name': video.get('original_name', ''),
        'segment_name': segment_name,
        'object_label': object_label,
        'current_visual_caption': visual_caption,
        'current_visual_caption_vi': caption.get('visual_caption_vi', ''),
        'prompt': _build_review_prompt(object_label, segment_name, visual_caption),
    }


@batch_review_bp.route('/batch-review/preview', methods=['GET'])
@token_required
def batch_review_preview():
    project_id = request.args.get('project_id')
    video_id = request.args.get('video_id')

    if not project_id:
        return jsonify({'error': 'project_id is required'}), 400

    try:
        db = current_app.db
        project = db.projects.find_one({'_id': ObjectId(project_id)})
        if not project:
            return jsonify({'error': 'Project not found'}), 404

        items = [
            _serialize_preview_item(video, segment, region, caption)
            for video, segment, region, caption in _iter_review_candidates(db, project_id, video_id)
        ]

        return jsonify({
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'project_id': project_id,
            'video_id': video_id,
            'total_items': len(items),
            'items': items,
        }), 200
    except Exception as e:
        logger.error(f"[BatchReviewPreview] {e}")
        return jsonify({'error': str(e)}), 500
```

- [ ] **Step 2: Register the blueprint in `backend/app.py`**

In `backend/app.py`, find the blueprint imports (around line 62-72):

```python
    from routes.auth import auth_bp
    from routes.projects import projects_bp
    from routes.videos import videos_bp
    from routes.segments import segments_bp
    from routes.annotations import annotations_bp
    from routes.tags import tags_bp
    from routes.settings import settings_bp
    from routes.categories import categories_bp
    from routes.knowledge_base import knowledge_base_bp
    from routes.images import images_bp
    from routes.stats import stats_bp
```

Add `from routes.batch_review import batch_review_bp` after the `annotations_bp` import line.

Find the blueprint registrations (around line 74-84):

```python
    app.register_blueprint(auth_bp, url_prefix='/api/auth')
    app.register_blueprint(projects_bp, url_prefix='/api/projects')
    app.register_blueprint(videos_bp, url_prefix='/api/videos')
    app.register_blueprint(segments_bp, url_prefix='/api/segments')
    app.register_blueprint(annotations_bp, url_prefix='/api/annotations')
    app.register_blueprint(tags_bp, url_prefix='/api/tags')
    app.register_blueprint(settings_bp, url_prefix='/api/settings')
    app.register_blueprint(categories_bp, url_prefix='/api/categories')
    app.register_blueprint(knowledge_base_bp, url_prefix='/api/knowledge-base')
    app.register_blueprint(images_bp, url_prefix='/api/images')
    app.register_blueprint(stats_bp, url_prefix='/api/stats')
```

Add this line after the `annotations_bp` registration (same `/api/annotations` prefix — Flask allows multiple blueprints to share a prefix since none of the concrete route paths collide):

```python
    app.register_blueprint(batch_review_bp, url_prefix='/api/annotations')
```

- [ ] **Step 3: Verify manually**

Restart the backend (`python app.py` in `backend/`), then:

```bash
curl -s "http://localhost:6800/api/annotations/batch-review/preview?project_id=$PROJECT_ID" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

Expected: HTTP 200 with a JSON body shaped like:
```json
{
  "generated_at": "...",
  "project_id": "...",
  "video_id": null,
  "total_items": N,
  "items": [
    {
      "caption_id": "...",
      "region_id": "...",
      "segment_id": "...",
      "video_id": "...",
      "video_name": "...",
      "segment_name": "...",
      "object_label": "...",
      "current_visual_caption": "...",
      "current_visual_caption_vi": "...",
      "prompt": "Object name (ground truth): ..."
    }
  ]
}
```
If `total_items` is 0, pick a different `PROJECT_ID` that has at least one region with a non-empty `visual_caption` (check via the existing `GET /api/annotations/region/<region_id>` endpoint or the video editor UI). Also verify the 400 path: `curl -s "http://localhost:6800/api/annotations/batch-review/preview" -H "Authorization: Bearer $TOKEN"` should return `{"error": "project_id is required"}`.

- [ ] **Step 4: Commit**

```bash
git add backend/routes/batch_review.py backend/app.py
git commit -m "feat: add Gemini batch caption review preview endpoint"
```

---

### Task 2: Backend — apply endpoint, task doc, and status endpoint (stub worker)

**Files:**
- Modify: `backend/routes/batch_review.py` (append apply + status endpoints, task serializer, stub worker)
- Modify: `backend/app.py:92-107` (add index for the new collection)

This task wires up the full request/response contract (validation, concurrency guard, task polling) with a **stub** worker that marks the task completed without calling Gemini, so the contract can be verified before adding the slower, harder-to-retest Gemini call in Task 3.

- [ ] **Step 1: Add the task serializer, apply endpoint, status endpoint, and stub worker**

Append to `backend/routes/batch_review.py`:

```python
def _serialize_task(task):
    return {
        'task_id': task['_id'],
        'project_id': task.get('project_id'),
        'video_id': task.get('video_id'),
        'status': task.get('status'),
        'total': task.get('total', 0),
        'processed': task.get('processed', 0),
        'succeeded': task.get('succeeded', 0),
        'failed': task.get('failed', 0),
        'error': task.get('error'),
        'results': task.get('results', []),
    }


def _run_batch_review(app, task_id, item_ids, gemini_api_key, gemini_model):
    """Background worker — stub for now, replaced with the real Gemini call in Task 3."""
    with app.app_context():
        db = current_app.db
        db.caption_review_tasks.update_one(
            {'_id': task_id},
            {'$set': {
                'status': 'completed',
                'processed': len(item_ids),
                'succeeded': 0,
                'failed': 0,
                'updated_at': datetime.now(timezone.utc),
            }}
        )


@batch_review_bp.route('/batch-review/apply', methods=['POST'])
@token_required
def batch_review_apply():
    data = request.get_json() or {}
    project_id = data.get('project_id')
    video_id = data.get('video_id')
    item_ids = data.get('item_ids') or []
    gemini_api_key = (data.get('gemini_api_key') or '').strip()
    gemini_model = (data.get('gemini_model') or '').strip() or _get_setting_value('gemini_model', 'gemini-2.5-flash')

    if not project_id:
        return jsonify({'error': 'project_id is required'}), 400
    if not item_ids:
        return jsonify({'error': 'item_ids must be a non-empty list'}), 400
    if not gemini_api_key:
        return jsonify({'error': 'gemini_api_key is required'}), 400

    db = current_app.db

    existing = db.caption_review_tasks.find_one({
        'project_id': project_id,
        'status': {'$in': ['pending', 'running']},
    })
    if existing:
        return jsonify({
            'error': 'A batch review job is already running for this project',
            'task_id': existing['_id'],
        }), 409

    task_id = str(uuid.uuid4())
    db.caption_review_tasks.insert_one({
        '_id': task_id,
        'project_id': project_id,
        'video_id': video_id,
        'status': 'pending',
        'total': len(item_ids),
        'processed': 0,
        'succeeded': 0,
        'failed': 0,
        'error': None,
        'results': [],
        'created_by': str(request.current_user['_id']),
        'created_at': datetime.now(timezone.utc),
        'updated_at': datetime.now(timezone.utc),
    })

    app = current_app._get_current_object()
    thread = threading.Thread(
        target=_run_batch_review,
        args=(app, task_id, item_ids, gemini_api_key, gemini_model)
    )
    thread.daemon = True
    thread.start()

    return jsonify({'task_id': task_id}), 202


@batch_review_bp.route('/batch-review/status/<task_id>', methods=['GET'])
@token_required
def batch_review_status(task_id):
    task = current_app.db.caption_review_tasks.find_one({'_id': task_id})
    if not task:
        return jsonify({'error': 'Task not found'}), 404
    return jsonify(_serialize_task(task)), 200
```

- [ ] **Step 2: Add a Mongo index for the new collection**

In `backend/app.py`, find the index-creation block (around line 92-107):

```python
    app.db.users.create_index('username', unique=True)
    app.db.users.create_index('email', unique=True)
    app.db.projects.create_index('created_by')
    app.db.videos.create_index('project_id')
    app.db.video_segments.create_index('video_id')
    app.db.object_regions.create_index('segment_id')
    app.db.captions.create_index('segment_id')
```

Add this line directly after `app.db.captions.create_index('segment_id')`:

```python
    app.db.caption_review_tasks.create_index('project_id')
```

- [ ] **Step 3: Verify manually**

Restart the backend, then re-run the preview call from Task 1 to get a real `caption_id`, and use it here:

```bash
CAPTION_ID=$(curl -s "http://localhost:6800/api/annotations/batch-review/preview?project_id=$PROJECT_ID" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json;print(json.load(sys.stdin)['items'][0]['caption_id'])")

curl -s -X POST http://localhost:6800/api/annotations/batch-review/apply \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"project_id\":\"$PROJECT_ID\",\"item_ids\":[\"$CAPTION_ID\"],\"gemini_api_key\":\"dummy-key-for-stub-test\"}"
```
Expected: HTTP 202 with `{"task_id": "<uuid>"}`. Take that `task_id` and poll:
```bash
curl -s "http://localhost:6800/api/annotations/batch-review/status/<task_id>" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```
Expected: within a second, `status` becomes `"completed"`, `processed` equals `1`, `results` is `[]` (stub doesn't populate it yet — that comes in Task 3).

Also verify the guards:
- Re-run the same `apply` call again immediately (before the stub finishes) — second call should get HTTP 409 `{"error": "A batch review job is already running for this project", ...}`. (The stub finishes almost instantly, so you may need to fire both curls back-to-back in the same second to observe this reliably — if you miss the window, that's fine, the concurrency-guard code path is simple enough to trust from reading it, and it gets exercised for real once Task 3 makes the worker slower.)
- `curl -s -X POST http://localhost:6800/api/annotations/batch-review/apply -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"project_id":"'$PROJECT_ID'","item_ids":[]}'` → HTTP 400 `{"error": "item_ids must be a non-empty list"}`.

- [ ] **Step 4: Commit**

```bash
git add backend/routes/batch_review.py backend/app.py
git commit -m "feat: add Gemini batch caption review apply/status endpoints (stub worker)"
```

---

### Task 3: Backend — real Gemini call in the worker

**Files:**
- Modify: `backend/routes/batch_review.py` (replace stub `_run_batch_review`, add `_call_gemini_with_retry`)

- [ ] **Step 1: Add the retry/backoff Gemini caller and replace the stub worker**

In `backend/routes/batch_review.py`, add this function above `_run_batch_review` (retry/backoff scheme mirrors `tools/caption_combiner/src/caption_combiner/01_regenerate.py:226-289`):

```python
def _call_gemini_with_retry(model, prompt, caption_id):
    """Call Gemini with a minimum request delay + exponential backoff on rate
    limits, mirroring tools/caption_combiner's call_gpt_with_retry.

    Returns (text, is_auth_error). text is None if every retry failed or the
    error was non-retryable; is_auth_error is True for an invalid/rejected key.
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

Replace the stub `_run_batch_review` function (added in Task 2) entirely with:

```python
def _run_batch_review(app, task_id, item_ids, gemini_api_key, gemini_model):
    import google.generativeai as genai

    with app.app_context():
        db = current_app.db
        db.caption_review_tasks.update_one(
            {'_id': task_id},
            {'$set': {'status': 'running', 'updated_at': datetime.now(timezone.utc)}}
        )

        try:
            genai.configure(api_key=gemini_api_key)
            model = genai.GenerativeModel(gemini_model)

            for index, caption_id in enumerate(item_ids):
                try:
                    caption = db.captions.find_one({'_id': ObjectId(caption_id)})
                except Exception:
                    caption = None

                result = {
                    'caption_id': caption_id,
                    'region_id': None,
                    'segment_name': '',
                    'object_label': '',
                    'video_name': '',
                    'old': {'visual_caption': '', 'visual_caption_vi': ''},
                    'new': None,
                    'status': 'error',
                    'error': 'Caption not found',
                }

                if caption:
                    region = db.object_regions.find_one({'_id': caption.get('region_id')}) if caption.get('region_id') else None
                    segment = db.video_segments.find_one({'_id': caption.get('segment_id')}) if caption.get('segment_id') else None
                    video = db.videos.find_one({'_id': caption.get('video_id')}) if caption.get('video_id') else None

                    object_label = region.get('label', '') if region else ''
                    segment_name = segment.get('name', '') if segment else ''
                    current_visual_caption = caption.get('visual_caption', '')

                    result.update({
                        'region_id': str(region['_id']) if region else None,
                        'segment_name': segment_name,
                        'object_label': object_label,
                        'video_name': video.get('original_name', '') if video else '',
                        'old': {
                            'visual_caption': current_visual_caption,
                            'visual_caption_vi': caption.get('visual_caption_vi', ''),
                        },
                    })

                    prompt = _build_review_prompt(object_label, segment_name, current_visual_caption)
                    text, is_auth_error = _call_gemini_with_retry(model, prompt, caption_id)

                    if is_auth_error and index == 0:
                        db.caption_review_tasks.update_one(
                            {'_id': task_id},
                            {'$set': {
                                'status': 'failed',
                                'error': 'Invalid Gemini API key',
                                'updated_at': datetime.now(timezone.utc),
                            }}
                        )
                        return

                    if is_auth_error:
                        result['status'] = 'error'
                        result['error'] = 'Invalid Gemini API key'
                    else:
                        parsed = _extract_json_from_text(text) if text else None
                        new_visual = ((parsed or {}).get('visual_caption') or '').strip()
                        new_visual_vi = ((parsed or {}).get('visual_caption_vi') or '').strip()

                        if new_visual and new_visual_vi:
                            # Intentionally does not call _reset_video_approval_if_needed
                            # (annotations.py:53-65) — bulk auto-fixes behave like the existing
                            # skip_approval_reset convention used by tools/caption_combiner, so a
                            # batch run doesn't flip already-approved videos back to review.
                            db.captions.update_one(
                                {'_id': caption['_id']},
                                {'$set': {
                                    'visual_caption': new_visual,
                                    'visual_caption_vi': new_visual_vi,
                                    'updated_at': datetime.now(timezone.utc),
                                }}
                            )
                            result['status'] = 'ok'
                            result['error'] = None
                            result['new'] = {'visual_caption': new_visual, 'visual_caption_vi': new_visual_vi}
                        else:
                            result['status'] = 'error'
                            result['error'] = 'Gemini did not return valid JSON with both fields'

                succeeded_inc = 1 if result['status'] == 'ok' else 0
                failed_inc = 0 if result['status'] == 'ok' else 1
                db.caption_review_tasks.update_one(
                    {'_id': task_id},
                    {
                        '$push': {'results': result},
                        '$inc': {'processed': 1, 'succeeded': succeeded_inc, 'failed': failed_inc},
                        '$set': {'updated_at': datetime.now(timezone.utc)},
                    }
                )

            db.caption_review_tasks.update_one(
                {'_id': task_id, 'status': {'$ne': 'failed'}},
                {'$set': {'status': 'completed', 'updated_at': datetime.now(timezone.utc)}}
            )
        except Exception as e:
            logger.error(f"[BatchReview] task {task_id} failed: {e}")
            try:
                db.caption_review_tasks.update_one(
                    {'_id': task_id},
                    {'$set': {'status': 'failed', 'error': str(e), 'updated_at': datetime.now(timezone.utc)}}
                )
            except Exception:
                pass
```

- [ ] **Step 2: Verify manually with a real Gemini API key**

You'll need a real Gemini API key for this step (get one at https://aistudio.google.com/apikey if you don't have one — this is just for local verification, it is never persisted anywhere by this feature).

```bash
export GEMINI_KEY=<your real key>

CAPTION_ID=$(curl -s "http://localhost:6800/api/annotations/batch-review/preview?project_id=$PROJECT_ID" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json;print(json.load(sys.stdin)['items'][0]['caption_id'])")

curl -s -X POST http://localhost:6800/api/annotations/batch-review/apply \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"project_id\":\"$PROJECT_ID\",\"item_ids\":[\"$CAPTION_ID\"],\"gemini_api_key\":\"$GEMINI_KEY\",\"gemini_model\":\"gemini-2.5-flash\"}"
```
Take the returned `task_id` and poll every couple seconds:
```bash
curl -s "http://localhost:6800/api/annotations/batch-review/status/<task_id>" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```
Expected: `status` moves `pending` → `running` → `completed`; `results[0].status` is `"ok"`; `results[0].new.visual_caption` and `results[0].new.visual_caption_vi` are non-empty rewritten captions. Then re-run the Task 1 preview curl and confirm `current_visual_caption` for that `caption_id` now shows the corrected text — proving the write-back actually persisted to `captions`.

Also verify the auth-error short-circuit: repeat the `apply` call with `"gemini_api_key":"invalid-key-xyz"` — expect the task to end with `status: "failed"`, `error: "Invalid Gemini API key"`.

- [ ] **Step 3: Commit**

```bash
git add backend/routes/batch_review.py
git commit -m "feat: call Gemini with retry/backoff in batch caption review worker"
```

---

### Task 4: Frontend — types and service methods

**Files:**
- Modify: `frontend/src/app/core/models/index.ts` (add interfaces after the `Caption` interface, currently ending around line 173)
- Modify: `frontend/src/app/core/services/video.service.ts` (add methods + import, currently ends its `ANNOTATIONS_API` section around line 232)

- [ ] **Step 1: Add TS interfaces**

In `frontend/src/app/core/models/index.ts`, insert this immediately after the closing `}` of the existing `Caption` interface (right before `export interface SegmentationResponse`):

```ts
export interface BatchReviewItem {
  caption_id: string;
  region_id: string;
  segment_id: string;
  video_id: string;
  video_name: string;
  segment_name: string;
  object_label: string;
  current_visual_caption: string;
  current_visual_caption_vi: string;
  prompt: string;
}

export interface BatchReviewPreview {
  generated_at: string;
  project_id: string;
  video_id: string | null;
  total_items: number;
  items: BatchReviewItem[];
}

export interface BatchReviewResult {
  caption_id: string;
  region_id: string | null;
  segment_name: string;
  object_label: string;
  video_name: string;
  old: { visual_caption: string; visual_caption_vi: string };
  new: { visual_caption: string; visual_caption_vi: string } | null;
  status: 'ok' | 'error';
  error: string | null;
}

export interface BatchReviewTask {
  task_id: string;
  project_id: string;
  video_id: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  error: string | null;
  results: BatchReviewResult[];
}
```

- [ ] **Step 2: Add service methods**

In `frontend/src/app/core/services/video.service.ts`, update the import at line 4 from:

```ts
import { VideoItem, VideoSegment, ObjectRegion, SegmentationResponse, Caption, Category, DurationStats } from '../models';
```

to:

```ts
import { VideoItem, VideoSegment, ObjectRegion, SegmentationResponse, Caption, Category, DurationStats, BatchReviewPreview, BatchReviewTask } from '../models';
```

Then add these methods directly after `getSegmentedKbMetadata` (currently ending around line 232, right before the `// ---- DAM Auto-Caption` comment):

```ts
  // ---- Gemini Batch Caption Review ----
  getBatchReviewPreview(projectId: string, videoId?: string): Observable<BatchReviewPreview> {
    const url = `${this.ANNOTATIONS_API}/batch-review/preview?project_id=${projectId}`
      + (videoId ? `&video_id=${videoId}` : '');
    return this.http.get<BatchReviewPreview>(url);
  }

  startBatchReview(
    projectId: string,
    videoId: string | null,
    itemIds: string[],
    apiKey: string,
    model?: string
  ): Observable<{ task_id: string }> {
    return this.http.post<{ task_id: string }>(`${this.ANNOTATIONS_API}/batch-review/apply`, {
      project_id: projectId,
      video_id: videoId,
      item_ids: itemIds,
      gemini_api_key: apiKey,
      gemini_model: model,
    });
  }

  getBatchReviewStatus(taskId: string): Observable<BatchReviewTask> {
    return this.http.get<BatchReviewTask>(`${this.ANNOTATIONS_API}/batch-review/status/${taskId}`);
  }
```

- [ ] **Step 3: Verify manually**

```bash
cd frontend && npm run build
```
Expected: build succeeds with no TypeScript errors (this catches typos in the interfaces/imports before any UI is wired up).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/core/models/index.ts frontend/src/app/core/services/video.service.ts
git commit -m "feat: add frontend types and service methods for Gemini batch caption review"
```

---

### Task 5: Frontend — review dialog component (setup + preview step)

**Files:**
- Create: `frontend/src/app/pages/project-detail/batch-caption-review-dialog/batch-caption-review-dialog.component.ts`
- Create: `frontend/src/app/pages/project-detail/batch-caption-review-dialog/batch-caption-review-dialog.component.html`
- Create: `frontend/src/app/pages/project-detail/batch-caption-review-dialog/batch-caption-review-dialog.component.scss`

This task covers the first two dialog steps: `setup` (explain + "Generate Preview" button) and `preview` (checkbox table + raw JSON view). The `running`/`done` steps are added in Task 6 so each task stays reviewable on its own.

- [ ] **Step 1: Create the component class**

Create `frontend/src/app/pages/project-detail/batch-caption-review-dialog/batch-caption-review-dialog.component.ts`:

```ts
import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BatchReviewPreview, BatchReviewTask } from '../../../core/models';
import { VideoService } from '../../../core/services/video.service';

type DialogStep = 'setup' | 'preview' | 'running' | 'done';

@Component({
  selector: 'app-batch-caption-review-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule,
    MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatProgressBarModule
  ],
  templateUrl: './batch-caption-review-dialog.component.html',
  styleUrls: ['./batch-caption-review-dialog.component.scss']
})
export class BatchCaptionReviewDialogComponent {
  step: DialogStep = 'setup';
  loadingPreview = false;
  preview: BatchReviewPreview | null = null;
  selected = new Set<string>();
  showRawJson = false;

  apiKey = '';
  model = 'gemini-2.5-flash';
  starting = false;
  task: BatchReviewTask | null = null;

  constructor(
    private dialogRef: MatDialogRef<BatchCaptionReviewDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { projectId: string },
    private videoService: VideoService,
    private snackBar: MatSnackBar
  ) {}

  generatePreview(): void {
    this.loadingPreview = true;
    this.videoService.getBatchReviewPreview(this.data.projectId).subscribe({
      next: (res) => {
        this.preview = res;
        this.selected = new Set(res.items.map(i => i.caption_id));
        this.step = 'preview';
        this.loadingPreview = false;
      },
      error: (err) => {
        this.loadingPreview = false;
        this.snackBar.open('Failed to generate preview: ' + err.message, 'Close', { duration: 4000 });
      }
    });
  }

  toggleItem(captionId: string): void {
    if (this.selected.has(captionId)) {
      this.selected.delete(captionId);
    } else {
      this.selected.add(captionId);
    }
  }

  isSelected(captionId: string): boolean {
    return this.selected.has(captionId);
  }

  get selectedCount(): number {
    return this.selected.size;
  }

  get previewJson(): string {
    return this.preview ? JSON.stringify(this.preview, null, 2) : '';
  }

  close(): void {
    this.dialogRef.close();
  }
}
```

- [ ] **Step 2: Create the template**

Create `frontend/src/app/pages/project-detail/batch-caption-review-dialog/batch-caption-review-dialog.component.html`:

```html
<h2 mat-dialog-title>Batch Review Visual Captions (Gemini)</h2>

<mat-dialog-content class="batch-review-content">
  <ng-container *ngIf="step === 'setup'">
    <p>
      Scans every object-level caption in this project and lets Gemini correct captions that
      misidentify the labeled object, using the object's name and segment name as ground truth,
      then translates the fix to Vietnamese. Nothing is sent to Gemini until you review the
      preview below and approve it.
    </p>
    <button mat-raised-button color="primary" (click)="generatePreview()" [disabled]="loadingPreview">
      {{ loadingPreview ? 'Generating preview...' : 'Generate Preview' }}
    </button>
  </ng-container>

  <ng-container *ngIf="step === 'preview' && preview">
    <div class="preview-header">
      <span>{{ preview.total_items }} object caption(s) found &mdash; {{ selectedCount }} selected</span>
      <button mat-button (click)="showRawJson = !showRawJson">
        {{ showRawJson ? 'Hide raw JSON' : 'View raw JSON' }}
      </button>
    </div>

    <pre *ngIf="showRawJson" class="raw-json">{{ previewJson }}</pre>

    <table *ngIf="!showRawJson" class="preview-table">
      <thead>
        <tr>
          <th></th>
          <th>Segment</th>
          <th>Object</th>
          <th>Current caption (EN)</th>
          <th>Current caption (VI)</th>
        </tr>
      </thead>
      <tbody>
        <tr *ngFor="let item of preview.items">
          <td><mat-checkbox [checked]="isSelected(item.caption_id)" (change)="toggleItem(item.caption_id)"></mat-checkbox></td>
          <td>{{ item.segment_name }}</td>
          <td>{{ item.object_label }}</td>
          <td>{{ item.current_visual_caption }}</td>
          <td>{{ item.current_visual_caption_vi }}</td>
        </tr>
      </tbody>
    </table>
  </ng-container>
</mat-dialog-content>

<mat-dialog-actions align="end">
  <button mat-button (click)="close()">Close</button>
</mat-dialog-actions>
```

- [ ] **Step 3: Create the stylesheet**

Create `frontend/src/app/pages/project-detail/batch-caption-review-dialog/batch-caption-review-dialog.component.scss`:

```scss
.batch-review-content {
  min-width: 700px;
  max-height: 70vh;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.raw-json {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 12px;
  border-radius: 4px;
  max-height: 400px;
  overflow: auto;
  font-size: 12px;
}

.preview-table {
  width: 100%;
  border-collapse: collapse;

  th, td {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid #e0e0e0;
    font-size: 13px;
    vertical-align: top;
  }
}
```

- [ ] **Step 4: Verify manually**

```bash
cd frontend && npm run build
```
Expected: build succeeds (this component isn't wired to any page yet, so it only needs to compile standalone — Task 7 wires it in and gives you a way to click-test it).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/pages/project-detail/batch-caption-review-dialog/
git commit -m "feat: add batch caption review dialog (setup + preview steps)"
```

---

### Task 6: Frontend — review dialog component (approve + run + poll + results steps)

**Files:**
- Modify: `frontend/src/app/pages/project-detail/batch-caption-review-dialog/batch-caption-review-dialog.component.ts`
- Modify: `frontend/src/app/pages/project-detail/batch-caption-review-dialog/batch-caption-review-dialog.component.html`
- Modify: `frontend/src/app/pages/project-detail/batch-caption-review-dialog/batch-caption-review-dialog.component.scss`

- [ ] **Step 1: Add polling + run logic to the component class**

In `batch-caption-review-dialog.component.ts`, change the class to implement `OnDestroy` and add the `rxjs` import. Replace:

```ts
import { Component, Inject } from '@angular/core';
```

with:

```ts
import { Component, Inject, OnDestroy } from '@angular/core';
import { Subscription, interval } from 'rxjs';
```

Replace the class declaration line:

```ts
export class BatchCaptionReviewDialogComponent {
```

with:

```ts
export class BatchCaptionReviewDialogComponent implements OnDestroy {
```

Add a field for the polling subscription — insert `private pollingSub: Subscription | null = null;` directly after the existing `task: BatchReviewTask | null = null;` field.

Add these methods to the class, right after the `close()` method (before the final closing `}` of the class):

```ts
  ngOnDestroy(): void {
    this.pollingSub?.unsubscribe();
  }

  startReview(): void {
    if (!this.apiKey.trim() || this.selectedCount === 0) return;

    this.starting = true;
    this.videoService.startBatchReview(
      this.data.projectId,
      this.preview?.video_id ?? null,
      Array.from(this.selected),
      this.apiKey.trim(),
      this.model
    ).subscribe({
      next: (res) => {
        this.starting = false;
        this.step = 'running';
        this.pollingSub = interval(2000).subscribe(() => this.pollStatus(res.task_id));
        this.pollStatus(res.task_id);
      },
      error: (err) => {
        this.starting = false;
        this.snackBar.open('Failed to start review: ' + err.message, 'Close', { duration: 4000 });
      }
    });
  }

  private pollStatus(taskId: string): void {
    this.videoService.getBatchReviewStatus(taskId).subscribe({
      next: (task) => {
        this.task = task;
        if (task.status === 'completed' || task.status === 'failed') {
          this.pollingSub?.unsubscribe();
          this.step = 'done';
        }
      },
      error: (err) => {
        this.pollingSub?.unsubscribe();
        this.snackBar.open('Lost connection to review job: ' + err.message, 'Close', { duration: 4000 });
      }
    });
  }
```

- [ ] **Step 2: Add the approve/run/results markup**

In `batch-caption-review-dialog.component.html`, insert this block directly after the closing `</table>` of the preview table and before the closing `</ng-container>` of the `step === 'preview'` block:

```html
    <div class="approve-row">
      <mat-form-field appearance="outline">
        <mat-label>Gemini API key</mat-label>
        <input matInput type="password" [(ngModel)]="apiKey" autocomplete="off">
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Model</mat-label>
        <mat-select [(ngModel)]="model">
          <mat-option value="gemini-2.5-flash">gemini-2.5-flash</mat-option>
          <mat-option value="gemini-2.5-pro">gemini-2.5-pro</mat-option>
          <mat-option value="gemini-2.0-flash">gemini-2.0-flash</mat-option>
        </mat-select>
      </mat-form-field>
      <button mat-raised-button color="primary" (click)="startReview()" [disabled]="starting || selectedCount === 0 || !apiKey.trim()">
        {{ starting ? 'Starting...' : 'Approve & Run' }}
      </button>
    </div>
```

Then add a new `ng-container` for the `running`/`done` steps directly after the `step === 'preview'` container's closing `</ng-container>`, still inside `<mat-dialog-content>`:

```html
  <ng-container *ngIf="step === 'running' || step === 'done'">
    <p *ngIf="task">{{ task.processed }} / {{ task.total }} processed &mdash; {{ task.succeeded }} succeeded, {{ task.failed }} failed</p>
    <mat-progress-bar *ngIf="step === 'running'" mode="determinate" [value]="task && task.total ? (task.processed / task.total * 100) : 0"></mat-progress-bar>
    <p *ngIf="task?.status === 'failed'" class="error-banner">{{ task?.error }}</p>

    <table *ngIf="task && task.results.length" class="results-table">
      <thead>
        <tr>
          <th>Segment</th>
          <th>Object</th>
          <th>Old caption (EN)</th>
          <th>New caption (EN)</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        <tr *ngFor="let r of task!.results" [class.error-row]="r.status === 'error'">
          <td>{{ r.segment_name }}</td>
          <td>{{ r.object_label }}</td>
          <td>{{ r.old.visual_caption }}</td>
          <td>{{ r.new?.visual_caption || '—' }}</td>
          <td>{{ r.status === 'ok' ? '✓' : r.error }}</td>
        </tr>
      </tbody>
    </table>
  </ng-container>
```

- [ ] **Step 3: Add styles for the new markup**

In `batch-caption-review-dialog.component.scss`, add:

```scss
.approve-row {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-top: 16px;
  flex-wrap: wrap;
}

.results-table {
  width: 100%;
  border-collapse: collapse;

  th, td {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid #e0e0e0;
    font-size: 13px;
    vertical-align: top;
  }
}

.error-row {
  background: #fdecea;
}

.error-banner {
  color: #c62828;
  font-weight: 500;
}
```

- [ ] **Step 4: Verify manually**

```bash
cd frontend && npm run build
```
Expected: build succeeds with no TypeScript/template errors. Full end-to-end click-through happens in Task 7 once the dialog is reachable from the UI.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/pages/project-detail/batch-caption-review-dialog/
git commit -m "feat: add approve/run/poll/results steps to batch caption review dialog"
```

---

### Task 7: Frontend — wire the entry point into Project Detail

**Files:**
- Modify: `frontend/src/app/pages/project-detail/project-detail.component.ts`
- Modify: `frontend/src/app/pages/project-detail/project-detail.component.html`

- [ ] **Step 1: Import the dialog and add an open method**

In `frontend/src/app/pages/project-detail/project-detail.component.ts`, add this import alongside the other page-local imports (near the top of the file, wherever the component's own imports are — e.g. after the `MatDialog` import around line 20):

```ts
import { BatchCaptionReviewDialogComponent } from './batch-caption-review-dialog/batch-caption-review-dialog.component';
```

Add this method directly after `openTagManager()` (around line 836-840):

```ts
  openBatchCaptionReview(): void {
    if (!this.project) return;
    this.dialog.open(BatchCaptionReviewDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      data: { projectId: this.project.id }
    });
  }
```

- [ ] **Step 2: Add the entry button**

In `frontend/src/app/pages/project-detail/project-detail.component.html`, add this button directly after the "Chỉ tải metadata.json" button (line 28-30):

```html
      <button mat-icon-button matTooltip="Batch Review Visual Captions (Gemini)" (click)="openBatchCaptionReview()" *ngIf="project">
        <mat-icon>auto_fix_high</mat-icon>
      </button>
```

- [ ] **Step 3: Verify manually end-to-end**

With both the backend (`python app.py`, port 6800) and frontend (`npm start`, port 4200) running:
1. Open `http://localhost:4200`, log in, open any project that has at least one object region with a non-empty visual caption.
2. Click the new "auto_fix_high" icon button in the nav bar.
3. Click "Generate Preview" — confirm the table populates with real segment names, object names, and current captions matching what you see in the video editor for that project. Toggle "View raw JSON" and confirm the JSON matches the table (including the `prompt` field per item).
4. Uncheck a row, confirm the "N selected" count decrements.
5. Paste a real Gemini API key, pick a model, click "Approve & Run".
6. Confirm the progress bar advances and the results table fills in with old vs. new captions and a `✓`/error status per row.
7. Close the dialog, reopen it, click "Generate Preview" again — confirm the previously-fixed row's `current_visual_caption` now shows the corrected text (proving the backend write-back persisted and the UI reflects it).
8. Open the video editor for that segment/object directly and confirm the visual caption shown there also matches the corrected text.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/pages/project-detail/project-detail.component.ts frontend/src/app/pages/project-detail/project-detail.component.html
git commit -m "feat: add entry point for Gemini batch caption review on project detail page"
```

---

## Post-plan notes

- The Gemini API key is never written to `db.settings` or `localStorage` by this feature — it lives only in the `apiKey` component field and the `apply` POST body, matching the design spec's security section.
- Concurrency is capped at one active batch job per project (`409` on a second `apply` while one is `pending`/`running`); there's no UI affordance yet for "cancel a running job" — out of scope per the spec.
- If a future task wants to extend this to segment-level captions, note that `video_segments`-level `captions` docs have no `visual_caption` field today (confirmed in `backend/routes/annotations.py:109-138` vs `:141-169`) — that would need its own schema decision, not a trivial extension of `_iter_review_candidates`.
