# Design Specification: Batch Knowledge Base Assignment Modal & Global Video KB

## Goal
Provide a fast, batch-input workflow for assigning Knowledge Base (KB) IDs across all segments and object tracks in a video, accessible via a modal button placed near the video pagination control in the Video Editor.

## Requirements
1. **Modal Trigger Button**:
   - Location: In the top info bar (`info-bar-right`), directly adjacent to the Video Navigation (pagination) control.
   - UI: A styled button labeled `Batch KB` with a `auto_awesome` / `collections_bookmark` icon and tooltip `"Batch Knowledge Base Assignment"`.
   - Behavior: Opens the `BatchKnowledgeDialogComponent` modal.

2. **Modal Feature Architecture**:
   The modal brings together **Option 1 (Batch Assignment to All)** and **Option 2 (Global Video KB)** in an intuitive multi-tab or stacked section layout:

   ### A. Global Video KB (Option 2)
   - Allows selecting Knowledge Base nodes that represent the entire video's domain/context (stored in video level `knowledge_base_ids`).
   - Includes **"Apply Global KB to All Segments & Object Tracks"** action: copies video global KB IDs into all existing segments and object tracks in 1 click.

   ### B. Segment Batch Assignment (Option 1 - Segments)
   - Allows selecting KB nodes to apply in batch across segments.
   - Actions:
     - **Apply to ALL Segments (Overwrite)**: Replaces `knowledge_base_ids` for all video segments.
     - **Append to ALL Segments (Merge)**: Merges selected KB IDs into all video segments without removing existing ones.
     - **Clear ALL Segments**: Clears KB IDs for all segments.

   ### C. Object Track Batch Assignment (Option 1 - Objects)
   - Allows selecting KB nodes to apply in batch across object tracks.
   - Actions:
     - **Apply to ALL Objects (Overwrite)**: Replaces `knowledge_base_ids` for all object tracks.
     - **Append to ALL Objects (Merge)**: Merges selected KB IDs into all object tracks without removing existing ones.
     - **Clear ALL Objects**: Clears KB IDs for all object tracks.

3. **Data & Synchronization**:
   - Updates `segmentCaptionKBIds` and `segment.caption.knowledge_base_ids` for segments.
   - Updates `captionKBIds`, `regionCaptionCache`, and `region.caption.knowledge_base_ids` for object tracks.
   - Updates `video.knowledge_base_ids` for global video context.
   - Persists all changes to the backend via `VideoService.updateVideoAnnotations` and triggers feedback notifications via `MatSnackBar`.

## Component Design & Architecture
- **Component**: `frontend/src/app/pages/batch-knowledge-dialog/batch-knowledge-dialog.component.ts` (standalone dialog component, or integrated within `video-editor`).
- **Imports**: `KnowledgeBaseSelectorComponent`, `MatDialogModule`, `MatButtonModule`, `MatTabsModule`, `MatIconModule`, `MatSnackBarModule`, `CommonModule`, `FormsModule`.
- **Inputs to Dialog**:
  - `video`: Video metadata and annotations object.
  - `segments`: Current video segments list.
  - `objectTracks`: Current object tracks / regions list.
  - `regionCaptionCache`: Reference to the cached object captions.

## Verification Plan
1. Open video editor on a video with multiple segments and object tracks.
2. Verify the `Batch KB` button appears next to video pagination.
3. Open the dialog and test:
   - Setting Global Video KB and clicking "Apply Global KB to All".
   - Batch applying/appending KB to all segments.
   - Batch applying/appending KB to all object tracks.
4. Verify all segments and object tracks in Step 3 reflect updated Knowledge Base IDs.
5. Save/Export annotations and confirm persistence.
