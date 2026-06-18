import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { VideoItem, VideoSegment, ObjectRegion, SegmentationResponse, Caption, Category, DurationStats } from '../models';
import { DamService } from './dam.service';

@Injectable({ providedIn: 'root' })
export class VideoService {
  private readonly API = '/api/videos';
  private readonly SEGMENTS_API = '/api/segments';
  private readonly ANNOTATIONS_API = '/api/annotations';
  private readonly CATEGORIES_API = '/api/categories';
  private readonly STATS_API = '/api/stats';

  constructor(private http: HttpClient, private dam: DamService) {}

  // ---- Videos ----
  uploadVideo(projectId: string, file: File, subpartId?: string, duration?: number, thumbnail?: Blob): Observable<any> {
    const formData = new FormData();
    formData.append('video', file);
    formData.append('project_id', projectId);
    if (subpartId) formData.append('subpart_id', subpartId);
    if (duration) formData.append('duration', duration.toString());
    if (thumbnail) formData.append('thumbnail', thumbnail, 'thumb.jpg');
    return this.http.post(`${this.API}/upload`, formData);
  }

  /**
   * Trim a source video via the backend. Backend asks dam_server to encode
   * (using the DAM URL the user configured in Settings) and saves the
   * result. Returns the new VideoItem record.
   */
  trimVideo(opts: {
    sourceVideoId: string;
    cutRanges: { start_sec: number; end_sec: number }[];
    targetName?: string;
    durationHint?: number;
  }): Observable<VideoItem> {
    return this.http.post<VideoItem>(`${this.API}/trim`, {
      source_video_id: opts.sourceVideoId,
      cut_ranges: opts.cutRanges,
      target_name: opts.targetName,
      duration_hint: opts.durationHint,
      dam_url: this.dam.getDamUrl(),
    });
  }

  getProjectVideos(projectId: string): Observable<VideoItem[]> {
    return this.http.get<VideoItem[]>(`${this.API}/project/${projectId}`);
  }

  getSubpartVideos(subpartId: string): Observable<VideoItem[]> {
    return this.http.get<VideoItem[]>(`${this.API}/subpart/${subpartId}`);
  }

  getVideo(videoId: string): Observable<VideoItem> {
    return this.http.get<VideoItem>(`${this.API}/${videoId}`);
  }

  updateVideo(videoId: string, data: Partial<VideoItem>): Observable<any> {
    return this.http.put(`${this.API}/${videoId}`, data);
  }

  deleteVideo(videoId: string): Observable<any> {
    return this.http.delete(`${this.API}/${videoId}`);
  }

  // ---- Segments ----
  getVideoSegments(videoId: string): Observable<VideoSegment[]> {
    return this.http.get<VideoSegment[]>(`${this.SEGMENTS_API}/video/${videoId}`);
  }

  createSegment(videoId: string, data: Partial<VideoSegment>): Observable<VideoSegment> {
    return this.http.post<VideoSegment>(`${this.SEGMENTS_API}/video/${videoId}`, data);
  }

  createSegmentsBatch(videoId: string, segments: Partial<VideoSegment>[], replace = false): Observable<VideoSegment[]> {
    return this.http.post<VideoSegment[]>(`${this.SEGMENTS_API}/video/${videoId}/batch`, { segments, replace });
  }

  updateSegment(segmentId: string, data: Partial<VideoSegment>): Observable<VideoSegment> {
    return this.http.put<VideoSegment>(`${this.SEGMENTS_API}/${segmentId}`, data);
  }

  deleteSegment(segmentId: string): Observable<any> {
    return this.http.delete(`${this.SEGMENTS_API}/${segmentId}`);
  }

  // ---- Regions (Segmentation) ----
  getSegmentRegions(segmentId: string): Observable<ObjectRegion[]> {
    return this.http.get<ObjectRegion[]>(`${this.SEGMENTS_API}/${segmentId}/regions`);
  }

  createRegion(segmentId: string, data: Partial<ObjectRegion>): Observable<ObjectRegion> {
    return this.http.post<ObjectRegion>(`${this.SEGMENTS_API}/${segmentId}/regions`, data);
  }

  updateRegion(regionId: string, data: Partial<ObjectRegion>): Observable<any> {
    return this.http.put(`${this.SEGMENTS_API}/regions/${regionId}`, data);
  }

  deleteRegion(regionId: string): Observable<any> {
    return this.http.delete(`${this.SEGMENTS_API}/regions/${regionId}`);
  }

  segmentObject(brushMask: string, frameImage?: string): Observable<SegmentationResponse> {
    return this.dam.segmentObject(brushMask, frameImage);
  }

  // ---- Categories ----
  getProjectCategories(projectId: string): Observable<Category[]> {
    return this.http.get<Category[]>(`${this.CATEGORIES_API}/project/${projectId}`);
  }

  createCategory(projectId: string, data: Partial<Category>): Observable<Category> {
    return this.http.post<Category>(`${this.CATEGORIES_API}/project/${projectId}`, data);
  }

  updateCategory(categoryId: string, data: Partial<Category>): Observable<Category> {
    return this.http.put<Category>(`${this.CATEGORIES_API}/${categoryId}`, data);
  }

  deleteCategory(categoryId: string): Observable<any> {
    return this.http.delete(`${this.CATEGORIES_API}/${categoryId}`);
  }

  // ---- Captions ----
  getSegmentCaptions(segmentId: string): Observable<Caption[]> {
    return this.http.get<Caption[]>(`${this.ANNOTATIONS_API}/segment/${segmentId}`);
  }

  getRegionCaption(regionId: string): Observable<Caption> {
    return this.http.get<Caption>(`${this.ANNOTATIONS_API}/region/${regionId}`);
  }

  getSegmentCaption(segmentId: string): Observable<Caption> {
    return this.http.get<Caption>(`${this.ANNOTATIONS_API}/segment-caption/${segmentId}`);
  }

  private ensureKbIds(payload: Partial<Caption>): Partial<Caption> {
    const kbIds = (payload as any)?.knowledge_base_ids;
    if (Array.isArray(kbIds)) {
      return {
        ...payload,
        knowledge_base_ids: kbIds.filter((id: any) => typeof id === 'string' && !!id)
      };
    }
    return {
      ...payload,
      knowledge_base_ids: []
    };
  }

  saveCaption(data: Partial<Caption> & { segment_id: string; video_id: string }): Observable<Caption> {
    return this.http.post<Caption>(this.ANNOTATIONS_API, this.ensureKbIds(data));
  }

  updateCaption(captionId: string, data: Partial<Caption>): Observable<Caption> {
    return this.http.put<Caption>(`${this.ANNOTATIONS_API}/${captionId}`, this.ensureKbIds(data));
  }

  deleteCaption(captionId: string): Observable<any> {
    return this.http.delete(`${this.ANNOTATIONS_API}/${captionId}`);
  }

  exportAnnotations(videoId: string): Observable<any> {
    return this.http.get(`${this.ANNOTATIONS_API}/export/video/${videoId}`);
  }

  exportProjectAnnotations(projectId: string): Observable<any> {
    return this.http.get(`${this.ANNOTATIONS_API}/export/project/${projectId}`);
  }

  downloadSegmentedVideo(videoId: string): Observable<Blob> {
    return this.http.get(`${this.ANNOTATIONS_API}/export/video/${videoId}/segmented`, {
      responseType: 'blob'
    });
  }

  startBatchSegmentedExport(projectId: string, subpartId?: string): Observable<{ task_id: string }> {
    const url = `${this.ANNOTATIONS_API}/export/project/${projectId}/segmented/start`
      + (subpartId ? `?subpart_id=${subpartId}` : '');
    return this.http.post<{ task_id: string }>(url, {});
  }

  checkBatchSegmentedExportStatus(taskId: string): Observable<{ task_id: string; status: string; progress: number; error?: string }> {
    return this.http.get<{ task_id: string; status: string; progress: number; error?: string }>(
      `${this.ANNOTATIONS_API}/export/segmented/status/${taskId}`
    );
  }

  getBatchSegmentedExportDownloadUrl(taskId: string): string {
    return `${this.ANNOTATIONS_API}/export/segmented/download/${taskId}`;
  }

  startLabeledVideosExport(projectId: string, subpartId?: string): Observable<{ task_id: string }> {
    const url = `${this.ANNOTATIONS_API}/export/project/${projectId}/labeled-videos/start`
      + (subpartId ? `?subpart_id=${subpartId}` : '');
    return this.http.post<{ task_id: string }>(url, {});
  }

  checkLabeledVideosExportStatus(taskId: string): Observable<{ task_id: string; status: string; progress: number; error?: string }> {
    return this.http.get<{ task_id: string; status: string; progress: number; error?: string }>(
      `${this.ANNOTATIONS_API}/export/labeled-videos/status/${taskId}`
    );
  }

  getLabeledVideosExportDownloadUrl(taskId: string): string {
    return `${this.ANNOTATIONS_API}/export/labeled-videos/download/${taskId}`;
  }

  startSegmentedKbExport(projectId: string, subpartId?: string): Observable<{ task_id: string }> {
    const url = `${this.ANNOTATIONS_API}/export/project/${projectId}/segmented-kb/start`
      + (subpartId ? `?subpart_id=${subpartId}` : '');
    return this.http.post<{ task_id: string }>(url, {});
  }

  checkSegmentedKbExportStatus(taskId: string): Observable<{ task_id: string; status: string; progress: number; error?: string }> {
    return this.http.get<{ task_id: string; status: string; progress: number; error?: string }>(
      `${this.ANNOTATIONS_API}/export/segmented-kb/status/${taskId}`
    );
  }

  getSegmentedKbExportDownloadUrl(taskId: string): string {
    return `${this.ANNOTATIONS_API}/export/segmented-kb/download/${taskId}`;
  }

  getSegmentedKbMetadata(projectId: string, subpartId?: string): Observable<any> {
    const url = `${this.ANNOTATIONS_API}/export/project/${projectId}/segmented-kb/metadata`
      + (subpartId ? `?subpart_id=${subpartId}` : '');
    return this.http.get<any>(url);
  }

  // ---- DAM Auto-Caption (Video: 8 frames) ----
  generateCaption(frames: string[], maskImage: string, captionType: 'visual' | 'contextual'): Observable<{ caption: string; caption_type: string }> {
    return this.dam.generateCaption(frames, maskImage, captionType);
  }

  generateCaptionBatch(frames: string[], maskImage: string): Observable<{ visual_caption: string; contextual_caption: string; warnings?: string[] }> {
    return this.dam.generateCaptionBatch(frames, maskImage);
  }

  // ---- Review ----
  submitForReview(videoId: string): Observable<any> {
    return this.http.post(`${this.API}/${videoId}/submit-review`, {});
  }

  reviewVideo(videoId: string, action: 'approve' | 'reject', comment?: string, qualityScores?: QualityScores): Observable<any> {
    return this.http.post(`${this.API}/${videoId}/review`, { action, comment, quality_scores: qualityScores });
  }

  revokeApproval(videoId: string, reason?: string): Observable<any> {
    return this.http.post(`${this.API}/${videoId}/revoke-approval`, { reason });
  }

  withdrawReview(videoId: string): Observable<any> {
    return this.http.post(`${this.API}/${videoId}/withdraw-review`, {});
  }

  // ---- AI Video Processing ----
  /**
   * Process video using DAM + DINOv2 + Gemini
   * - Extract 16 frames
   * - Search KB for each frame
   * - Get visual description from DAM
   * - Combine with Gemini for final description
   */
  processVideoAI(videoId: string, options?: {
    num_frames?: number;
    prompt?: string;
    use_gemini?: boolean;
  }): Observable<VideoProcessingResult> {
    return this.http.post<VideoProcessingResult>(`${this.API}/${videoId}/process`, options || {});
  }

  /**
   * Demo endpoint: upload a local video and return generated description.
   */
  processVideoDemo(file: File, options?: {
    num_frames?: number;
    prompt?: string;
    use_gemini?: boolean;
  }): Observable<VideoProcessingResult> {
    const formData = new FormData();
    formData.append('video', file);
    if (options?.num_frames !== undefined) formData.append('num_frames', String(options.num_frames));
    if (options?.prompt) formData.append('prompt', options.prompt);
    if (options?.use_gemini !== undefined) formData.append('use_gemini', String(options.use_gemini));
    return this.http.post<VideoProcessingResult>(`${this.API}/demo/process`, formData);
  }

  /**
   * Index video frames for similarity search
   */
  indexVideo(videoId: string): Observable<{ success: boolean; indexed_frames: number }> {
    return this.http.post<{ success: boolean; indexed_frames: number }>(`${this.API}/${videoId}/index`, {});
  }

  /**
   * Search for similar videos using an image query
   */
  searchByImage(queryImage: string, topK = 20): Observable<VideoSearchResult> {
    return this.http.post<VideoSearchResult>(`${this.API}/search`, {
      query_image: queryImage,
      top_k: topK
    });
  }

  getVideoDurationStats(): Observable<DurationStats> {
    return this.http.get<DurationStats>(`${this.STATS_API}/video-duration`);
  }

}

// ---- Types for AI Processing ----
export interface VideoProcessingResult {
  num_frames: number;
  dam_description: string;
  frame_knowledge: FrameKnowledge[];
  frame_similar_images?: FrameSimilarImages[];
  aggregated_knowledge: KnowledgeMatch[];
  similar_images?: SimilarImageMatch[];
  similar_images_message?: string;
  retrieval_debug?: RetrievalDebugInfo;
  english_description?: string;
  vietnamese_description?: string;
  final_description?: string;
  gemini_description?: string;
  gemini_error?: string;
  gemini_prompt?: string;
}

export interface FrameKnowledge {
  frame_idx: number;
  knowledge: KnowledgeMatch[];
}

export interface KnowledgeMatch {
  name: string;
  name_vi?: string;
  description: string;
  description_vi?: string;
  score: number;
}

export interface SimilarImageMatch {
  image_id: string;
  filename: string;
  original_name: string;
  url: string;
  project_id?: string | null;
  score: number;
}

export interface FrameSimilarImages {
  frame_idx: number;
  images: SimilarImageMatch[];
}

export interface RetrievalDebugInfo {
  image_embedding_count: number;
  kb_embedding_count: number;
  similar_images_count: number;
  knowledge_hits_count: number;
}

export interface VideoSearchResult {
  results: VideoSearchMatch[];
  total: number;
}

export interface VideoSearchMatch {
  video: VideoItem;
  score: number;
  frame_matches: { frame_index: number; score: number }[];
}

export interface QualityScores {
  accuracy: number;
  completeness: number;
  knowledge_integration: number;
  fluency_coherence: number;
  knowledge_relevance: number;
}
