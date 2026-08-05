# Batch Review Visual Captions Video Links Design

## Overview
Enhance the **Batch Review Visual Captions (Gemini)** modal to display video names as clickable hyperlinks (`<a href="/editor/:videoId" target="_blank">`). Clicking a video name opens that video in the video editor in a new browser tab, enabling annotators/reviewers to quickly inspect or fix videos during preview and results review.

## Requirements
1. **Preview Table**: In the setup/preview step table, render the **Video** column as an `<a>` link pointing to `/editor/<video_id>`, with `target="_blank"` and `rel="noopener noreferrer"`.
2. **Results Table**: In the running/done step results table, add a **Video** column (currently missing) that also links each result item to `/editor/<video_id>`.
3. **Backend Support**: Add `video_id` to the `BatchReviewResult` dictionary in `backend/routes/batch_review.py` so that task result items retain the video's ObjectId for link generation.
4. **Frontend Models**: Update `BatchReviewResult` interface in `frontend/src/app/core/models/index.ts` to include `video_id?: string | null`.
5. **UI & Styling**:
   - Style `.video-link` in `batch-caption-review-dialog.component.scss` with color `#60a5fa`, underline on hover, and inline `open_in_new` material icon.
   - Stop click event propagation (`(click)="$event.stopPropagation()"`) on video link clicks so clicking the link does not accidentally trigger row selection or dialog actions.

## Components & Changes

### 1. Backend: `backend/routes/batch_review.py`
- In `batch_review_task_worker` / `result` dictionary construction, ensure `'video_id': str(video['_id']) if video else None` is included in both the initial default dict and the populated dict.

### 2. Models: `frontend/src/app/core/models/index.ts`
- Update `BatchReviewResult`:
  ```typescript
  export interface BatchReviewResult {
    video_id?: string | null;
    video_name: string;
    ...
  }
  ```

### 3. Template: `frontend/src/app/pages/project-detail/batch-caption-review-dialog/batch-caption-review-dialog.component.html`
- In Preview table (`<tbody>`):
  ```html
  <td>
    <a [href]="'/editor/' + item.video_id" target="_blank" rel="noopener noreferrer" class="video-link" (click)="$event.stopPropagation()" matTooltip="Open video in new tab">
      <span>{{ item.video_name }}</span>
      <mat-icon class="external-icon">open_in_new</mat-icon>
    </a>
  </td>
  ```
- In Results table (`<thead>` and `<tbody>`):
  - Add `<th>Video</th>` after `<th>Type</th>`.
  - Add `<td>` with link when `r.video_id` exists, fallback text `r.video_name` when missing.

### 4. Styling: `frontend/src/app/pages/project-detail/batch-caption-review-dialog/batch-caption-review-dialog.component.scss`
- Add `.video-link` and `.external-icon` styles:
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
      font-size: 14px;
      width: 14px;
      height: 14px;
      opacity: 0.7;
    }
  }
  ```

## Testing & Verification
1. Verify Angular build compiles without errors (`npm run build` or `ng build`).
2. Verify Python backend syntax check (`python3 -m py_compile backend/routes/batch_review.py`).
