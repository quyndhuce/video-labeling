export interface User {
  id: string;
  username: string;
  email: string;
  full_name: string;
  role: string;
  avatar_color: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  full_name: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  project_type: 'video' | 'image';
  task_type?: 'object_detection' | 'classification' | 'captioning' | 'qa' | 'segmentation';
  status: string;
  created_by: string;
  creator_name?: string;
  subpart_count?: number;
  video_count?: number;
  image_count?: number;
  subparts?: SubPart[];
  videos?: VideoItem[];
  images?: ImageItem[];
  created_at: string;
  updated_at: string;
}

export interface SubPart {
  id: string;
  project_id: string;
  name: string;
  description: string;
  assigned_users: string[];
  assigned_user_details?: User[];
  reviewer?: string;
  reviewer_details?: User;
  // Multi-reviewer support
  reviewers?: string[];
  reviewer_details_list?: User[];
  order: number;
  status: string;
  video_count?: number;
  image_count?: number;
  created_at: string;
}

export interface ReviewEntry {
  reviewer_id: string;
  action: 'approve' | 'reject';
  comment?: string;
  quality_scores?: { [key: string]: number };
  reviewed_at: string;
}

export interface ReviewWithDetails {
  reviewer: User;
  reviewer_id?: string;
  action: 'approve' | 'reject';
  comment?: string;
  quality_scores?: { [key: string]: number };
  reviewed_at: string;
  reviewer_details?: User;
}

export interface VideoItem {
  id: string;
  project_id?: string;
  filename: string;
  original_name: string;
  file_size: number;
  duration: number;
  width: number;
  height: number;
  status: string;
  current_step: number;
  subpart_id?: string;
  url: string;
  thumbnail_url?: string;
  tags?: string[];
  uploaded_by: string;
  annotators?: string[];
  annotator_details?: User[];
  review_status?: string;
  review_comment?: string;
  reviewed_by?: string;
  reviewer_id?: string;
  reviewer_details?: User;
  // Multi-reviewer fields
  reviews?: ReviewEntry[];
  reviews_with_details?: ReviewWithDetails[];
  subpart_reviewers?: string[];
  reviewer_details_list?: User[];
  segments_count?: number;
  objects_count?: number;
  captions_count?: number;
  segments?: VideoSegment[];
  created_at: string;
}

export interface VideoSegment {
  id: string;
  video_id?: string;
  name: string;
  start_time: number;
  end_time: number;
  order: number;
  regions?: ObjectRegion[];
  regions_count?: number;
  captions_count?: number;
  created_at: string;
}

export interface ObjectRegion {
  id: string;
  segment_id: string;
  video_id: string;
  frame_time: number;
  brush_mask: string;
  segmented_mask: string;
  label: string;
  color: string;
  category_id?: string;
  category_name?: string;
  caption?: Caption;
  created_at: string;
}

export interface Category {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  color: string;
  created_at: string;
}

export interface Caption {
  id?: string;
  segment_id?: string;
  video_id?: string;
  region_id?: string;
  region_label?: string;
  region_color?: string;
  visual_caption: string;
  contextual_caption: string;
  knowledge_caption: string;
  combined_caption: string;
  visual_caption_vi: string;
  contextual_caption_vi: string;
  knowledge_caption_vi: string;
  combined_caption_vi: string;
  knowledge_base_ids?: string[];
  created_at?: string;
  updated_at?: string;
}

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
  subpart_id?: string | null;
  total_items: number;
  total_videos?: number;
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

export interface SegmentationResponse {
  segmented_mask: string;
  confidence: number;
  message: string;
}

export interface Tag {
  id: string;
  project_id: string;
  name: string;
  color: string;
  created_at: string;
}

// ============ IMAGE ANNOTATION MODELS ============

export interface ImageItem {
  id: string;
  project_id?: string;
  filename: string;
  original_name: string;
  file_size: number;
  width: number;
  height: number;
  status: string;
  current_step: number;
  subpart_id?: string;
  url: string;
  thumbnail_url?: string;
  tags?: string[];
  uploaded_by: string;
  annotators?: string[];
  annotator_details?: User[];
  review_status?: string;
  review_comment?: string;
  reviewed_by?: string;
  reviews?: ReviewEntry[];
  reviews_with_details?: ReviewWithDetails[];
  reviewers?: string[];
  reviewer_details_list?: User[];
  regions_count?: number;
  region_labels?: string[];
  captions_count?: number;
  qa_count?: number;
  has_caption?: boolean;
  has_classification?: boolean;
  indexed?: boolean;
  indexed_regions?: number;
  object_indexed_count?: number;
  objects_indexed_complete?: boolean;
  indexed_at?: string | null;
  classification?: ImageClassification;
  regions?: ImageRegion[];
  image_caption?: Caption;
  qa_pairs?: ImageQA[];
  knowledge_base_ids?: string[];  // KB linkage for image
  created_at: string;
}

export interface ImageRegion {
  id: string;
  image_id: string;
  label: string;
  color: string;
  category_id?: string;
  category_name?: string;
  bbox?: number[];  // [x, y, width, height]
  segmentation_mask: string;
  brush_mask: string;
  has_caption?: boolean;
  caption?: Caption;
  indexed?: boolean;
  indexed_at?: string | null;
  knowledge_base_ids?: string[];  // KB linkage for region/object
  created_at: string;
}

export interface ImageClassification {
  labels: string[];
  primary_label: string;
  confidence?: number;
  notes?: string;
}

export interface ImageQA {
  id: string;
  image_id?: string;
  question: string;
  answer: string;
  question_vi: string;
  answer_vi: string;
  qa_type: string;  // general, visual, contextual, etc.
  created_at: string;
}

export interface ImageQCStats {
  total_images: number;
  by_status: {
    pending: number;
    approved: number;
    rejected: number;
    not_submitted: number;
  };
  by_project: { [key: string]: { total: number; approved: number; rejected: number; pending: number } };
  by_user: UserStats[];
  recent_reviews: ImageReviewItem[];
  pending_reviews: ImagePendingReviewItem[];
}

export interface UserStats {
  id: string;
  name: string;
  color: string;
  total_reviews: number;
  approved: number;
  rejected: number;
  avg_quality_score?: number;
  avg_quality_scores?: { [key: string]: number };
}

export interface ImageReviewItem {
  image_id: string;
  image_name: string;
  project_name: string;
  reviewer_name: string;
  reviewer_color: string;
  status: string;
  reviewed_at: string;
}

export interface ImagePendingReviewItem {
  image_id: string;
  image_name: string;
  project_name: string;
  created_at: string;
}

export interface DurationStats {
  S: number;
  M: number;
  L: number;
  other: number;
  total: number;
}
