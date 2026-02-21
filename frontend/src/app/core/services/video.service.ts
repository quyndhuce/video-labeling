import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { VideoItem, VideoSegment, ObjectRegion, SegmentationResponse, Caption, Category } from '../models';

@Injectable({ providedIn: 'root' })
export class VideoService {
  private readonly API = '/api/videos';
  private readonly SEGMENTS_API = '/api/segments';
  private readonly ANNOTATIONS_API = '/api/annotations';
  private readonly CATEGORIES_API = '/api/categories';

  constructor(private http: HttpClient) {}

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
    return this.http.post<SegmentationResponse>(`${this.SEGMENTS_API}/segment-object`, {
      brush_mask: brushMask,
      frame_image: frameImage
    });
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

  saveCaption(data: Partial<Caption> & { segment_id: string; video_id: string }): Observable<Caption> {
    return this.http.post<Caption>(this.ANNOTATIONS_API, data);
  }

  updateCaption(captionId: string, data: Partial<Caption>): Observable<Caption> {
    return this.http.put<Caption>(`${this.ANNOTATIONS_API}/${captionId}`, data);
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

  // ---- DAM Auto-Caption (Video: 8 frames) ----
  generateCaption(frames: string[], maskImage: string, captionType: 'visual' | 'contextual'): Observable<{ caption: string; caption_type: string }> {
    return this.http.post<{ caption: string; caption_type: string }>(`${this.ANNOTATIONS_API}/generate-caption`, {
      frames,
      mask_image: maskImage,
      caption_type: captionType
    });
  }

  generateCaptionBatch(frames: string[], maskImage: string): Observable<{ visual_caption: string; contextual_caption: string; warnings?: string[] }> {
    return this.http.post<{ visual_caption: string; contextual_caption: string; warnings?: string[] }>(`${this.ANNOTATIONS_API}/generate-caption-batch`, {
      frames,
      mask_image: maskImage
    });
  }

  // ---- Review ----
  submitForReview(videoId: string): Observable<any> {
    return this.http.post(`${this.API}/${videoId}/submit-review`, {});
  }

  reviewVideo(videoId: string, action: 'approve' | 'reject', comment?: string): Observable<any> {
    return this.http.post(`${this.API}/${videoId}/review`, { action, comment });
  }

  revokeApproval(videoId: string, reason?: string): Observable<any> {
    return this.http.post(`${this.API}/${videoId}/revoke-approval`, { reason });
  }

  withdrawReview(videoId: string): Observable<any> {
    return this.http.post(`${this.API}/${videoId}/withdraw-review`, {});
  }
}
