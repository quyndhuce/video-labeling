# Batch Review Video Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable clickable video links in the Batch Review Visual Captions (Gemini) modal so users can click a video name to open it in a new tab in the video editor.

**Architecture:** Update backend task worker results to include `video_id`, update frontend model definitions, update `BatchCaptionReviewDialogComponent` HTML template and SCSS styles to render video links for both preview and results tables.

**Tech Stack:** Python (Flask/MongoDB backend), TypeScript (Angular 18 frontend, Angular Material).

## Global Constraints

- Preserve all existing functionality of the batch caption review modal.
- Links must open `/editor/:videoId` in a new tab (`target="_blank" rel="noopener noreferrer"`).
- Link clicks must not propagate to parent row selection.

---

### Task 1: Backend `video_id` in BatchReviewResult

**Files:**
- Modify: `backend/routes/batch_review.py:317-356`

**Interfaces:**
- Consumes: MongoDB `videos` collection (`ObjectId` `_id`)
- Produces: `video_id` string in `task.results` list items returned by `/batch-review/status/<task_id>`

- [ ] **Step 1: Check Python syntax before edit**

Run: `python3 -m py_compile backend/routes/batch_review.py`
Expected: Return code 0 (clean compile)

- [ ] **Step 2: Update `batch_review.py` result dictionary to include `video_id`**

In `backend/routes/batch_review.py`, inside `batch_review_task_worker`, update the default `result` dict (line ~317) and the populated `result.update(...)` dict (line ~345):

```python
                result = {
                    'caption_id': caption_id,
                    'level': None,
                    'region_id': None,
                    'segment_name': '',
                    'object_label': '',
                    'video_name': '',
                    'video_id': None,
                    'old': {'visual_caption': '', 'visual_caption_vi': ''},
                    'new': None,
                    'status': 'error',
                    'error': 'Caption not found',
                    'caption_field': 'visual_caption',
                    'applied': False,
                }
```
And:
```python
                    result.update({
                        'level': level,
                        'region_id': str(region['_id']) if region else None,
                        'segment_name': segment_name,
                        'object_label': object_label,
                        'video_name': video.get('original_name', '') if video else '',
                        'video_id': str(video['_id']) if video else None,
                        'old': {
                            'visual_caption': current_caption,
                            'visual_caption_vi': caption.get(field_vi, ''),
                        },
                        'caption_field': field_en,
                    })
```

- [ ] **Step 3: Verify Python syntax after edit**

Run: `python3 -m py_compile backend/routes/batch_review.py`
Expected: Return code 0

- [ ] **Step 4: Commit**

```bash
git add backend/routes/batch_review.py
git commit -m "feat(backend): include video_id in batch review task results"
```

---

### Task 2: Frontend Models, Template, and Styles for Video Links

**Files:**
- Modify: `frontend/src/app/core/models/index.ts:203-215`
- Modify: `frontend/src/app/pages/project-detail/batch-caption-review-dialog/batch-caption-review-dialog.component.html:86,136-163`
- Modify: `frontend/src/app/pages/project-detail/batch-caption-review-dialog/batch-caption-review-dialog.component.scss`

**Interfaces:**
- Consumes: `BatchReviewItem.video_id`, `BatchReviewItem.video_name`, `BatchReviewResult.video_id`, `BatchReviewResult.video_name`
- Produces: Clickable hyperlinks opening `/editor/:videoId` in new tab for both preview and results tables in Batch Review modal.

- [ ] **Step 1: Update `BatchReviewResult` interface in `index.ts`**

In `frontend/src/app/core/models/index.ts`, add `video_id?: string | null;` to `BatchReviewResult`:

```typescript
export interface BatchReviewResult {
  caption_id: string;
  level: 'segment' | 'object' | null;
  region_id: string | null;
  segment_name: string;
  object_label: string;
  video_name: string;
  video_id?: string | null;
  old: { visual_caption: string; visual_caption_vi: string };
  new: { visual_caption: string; visual_caption_vi: string } | null;
  status: 'ok' | 'error';
  error: string | null;
  applied: boolean;
}
```

- [ ] **Step 2: Update HTML template for Preview and Results tables**

In `frontend/src/app/pages/project-detail/batch-caption-review-dialog/batch-caption-review-dialog.component.html`:

In preview table row (line 86):
Replace:
```html
          <td>{{ item.video_name }}</td>
```
With:
```html
          <td>
            <a *ngIf="item.video_id" [href]="'/editor/' + item.video_id" target="_blank" rel="noopener noreferrer" class="video-link" (click)="$event.stopPropagation()" matTooltip="Open video in new tab">
              <span>{{ item.video_name }}</span>
              <mat-icon class="external-icon">open_in_new</mat-icon>
            </a>
            <span *ngIf="!item.video_id">{{ item.video_name }}</span>
          </td>
```

In results table headers (line ~138):
Replace:
```html
        <tr>
          <th *ngIf="step === 'done'"></th>
          <th>Type</th>
          <th>Segment</th>
          <th>Object</th>
          <th>Old caption (EN)</th>
          <th>New caption (EN)</th>
          <th>Status</th>
        </tr>
```
With:
```html
        <tr>
          <th *ngIf="step === 'done'"></th>
          <th>Type</th>
          <th>Video</th>
          <th>Segment</th>
          <th>Object</th>
          <th>Old caption (EN)</th>
          <th>New caption (EN)</th>
          <th>Status</th>
        </tr>
```

In results table row (line ~155):
Add `<td>` for Video right after the `Type` `<td>`:
```html
          <td>
            <a *ngIf="r.video_id" [href]="'/editor/' + r.video_id" target="_blank" rel="noopener noreferrer" class="video-link" (click)="$event.stopPropagation()" matTooltip="Open video in new tab">
              <span>{{ r.video_name }}</span>
              <mat-icon class="external-icon">open_in_new</mat-icon>
            </a>
            <span *ngIf="!r.video_id">{{ r.video_name }}</span>
          </td>
```

- [ ] **Step 3: Update SCSS for `.video-link` and `.external-icon`**

In `frontend/src/app/pages/project-detail/batch-caption-review-dialog/batch-caption-review-dialog.component.scss`:
Add styles for `.video-link` and `.external-icon`:

```scss
.video-link {
  color: #60a5fa;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 500;

  &:hover {
    text-decoration: underline;
    color: #93c5fd;
  }

  .external-icon {
    font-size: 13px;
    width: 13px;
    height: 13px;
    opacity: 0.75;
  }
}
```

- [ ] **Step 4: Verify Angular build**

Run: `cd frontend && npm run build`
Expected: Successful build with zero errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/core/models/index.ts frontend/src/app/pages/project-detail/batch-caption-review-dialog/
git commit -m "feat(frontend): add video editor links with new-tab popups in batch review modal"
```
