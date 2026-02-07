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
  status: string;
  created_by: string;
  creator_name?: string;
  subpart_count?: number;
  video_count?: number;
  subparts?: SubPart[];
  videos?: VideoItem[];
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
  order: number;
  status: string;
  video_count?: number;
  created_at: string;
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
  caption?: Caption;
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
  created_at?: string;
  updated_at?: string;
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
