export interface Progress {
  lecture_id?: string;
  position: number;
  duration: number;
  percent: number;
  watched: number;
  completed: number;
  auto_complete_blocked?: number;
  last_watched: number | null;
  intervals?: string | null;
}

export interface Lecture {
  id: string;
  course_id: string;
  section_id: string | null;
  title: string;
  file_path: string;
  duration: number | null;
  order_index: number;
  subtitle_paths: string | null;
  resources: string | null;
  needs_review: number;
  progress?: Progress;
}

export interface Section {
  id: string;
  course_id: string;
  title: string;
  order_index: number;
  lectures: Lecture[];
}

export interface Course {
  id: string;
  title: string;
  folder_path: string;
  created_at: number;
  last_watched: number | null;
  thumbnail_path: string | null;
  lecture_count: number;
  completed_count: number;
  review_count: number;
  progress: number;
  total_duration?: number;
  watched_duration?: number;
  last_activity?: number | null;
}

export interface CourseDetail {
  course: Course;
  sections: Section[];
}

export interface Note {
  id: string;
  course_id: string;
  lecture_id: string;
  timestamp: number | null;
  content: string;
  created_at: number;
}

export interface Bookmark {
  id: string;
  course_id: string;
  lecture_id: string;
  timestamp: number | null;
  description: string;
  created_at: number;
}

export interface SearchResult extends Lecture {
  course_title: string;
  section_title: string | null;
  completed: number;
  percent: number;
  position: number | null;
  duration: number | null;
  last_watched: number | null;
}

export interface ContinueLecture {
  id: string;
  title: string;
  course_id: string;
  course_title: string;
  section_title: string | null;
  position: number;
  duration: number;
  percent: number;
  last_watched: number | null;
  course_total: number;
  course_completed: number;
  course_progress: number;
  course_duration?: number;
  course_watched?: number;
}

export interface RecentItem {
  id: number;
  lecture_id: string;
  course_id: string;
  watched_at: number;
  lecture_title: string | null;
  course_title: string | null;
}

export interface ActivityDay {
  day: string;
  seconds: number;
  app_seconds: number;
}

export interface MissingCourse {
  id: string;
  title: string;
  folderPath: string;
}

export interface DataExportResult {
  success: boolean;
  canceled?: boolean;
  path?: string;
  counts?: Record<string, number>;
  error?: string;
}

export interface DataImportResult {
  success: boolean;
  canceled?: boolean;
  error?: string;
  preferences?: Record<string, string>;
  missingCourses?: MissingCourse[];
  counts?: Record<string, number>;
  safetyBackup?: string | null;
}

export interface RelocateResult {
  success: boolean;
  updated?: number;
  missing?: number;
  error?: string;
}

export interface Stats {
  totalCourses: number;
  totalLectures: number;
  completed: number;
  inProgress: number;
  needsReview: number;
  unwatched: number;
  progress: number;
  totalDuration: number;
  watchedDuration: number;
  continueLecture: ContinueLecture | null;
  recent: RecentItem[];
}

export type ThemeName = 'minimal' | 'light' | 'dark' | 'warm' | 'system';

export interface Settings {
  theme: ThemeName;
  autoplay: boolean;
  completionThreshold: number;
  playbackRate: number;
  captionSize: number;
  captionColor: string;
  captionBg: number;
}

export interface WindowState {
  maximized: boolean;
  fullscreen: boolean;
}

export interface AppVersions {
  app: string;
  electron: string;
  node: string;
  chrome: string;
}

export interface SubtitleFile {
  name: string;
  path: string;
  matched: boolean;
}

export interface ImportResult {
  success: boolean;
  courseId?: string;
  alreadyImported?: boolean;
  error?: string;
}

export type ToastType = 'success' | 'error' | 'info';

export interface Api {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<boolean>;
  closeWindow(): Promise<void>;
  toggleFullscreen(): Promise<boolean>;
  getWindowState(): Promise<WindowState>;
  onWindowState(callback: (state: WindowState) => void): () => void;

  selectFolder(title?: string): Promise<string | null>;
  getVersions(): Promise<AppVersions>;
  openDataFolder(): Promise<string>;
  openPath(filePath: string): Promise<boolean>;
  showInFolder(filePath: string): Promise<boolean>;

  exportData(preferences: Record<string, string>): Promise<DataExportResult>;
  importData(): Promise<DataImportResult>;

  importCourse(folderPath: string): Promise<ImportResult>;
  getCourses(): Promise<Course[]>;
  getCourse(id: string): Promise<CourseDetail | null>;
  scanCourse(id: string): Promise<{ success: boolean; added?: number; error?: string }>;
  deleteCourse(id: string): Promise<{ success: boolean }>;
  renameCourse(id: string, title: string): Promise<{ success: boolean; title?: string; error?: string }>;
  relocateCourse(id: string, folderPath: string): Promise<RelocateResult>;

  searchLectures(query: string): Promise<SearchResult[]>;
  listReviewLectures(): Promise<SearchResult[]>;
  setLectureReview(lectureId: string, needsReview: boolean): Promise<{ success: boolean; needs_review: number }>;

  getProgress(): Promise<Progress[]>;
  getLectureProgress(lectureId: string): Promise<Progress | null>;
  updateProgress(lectureId: string, data: Partial<Progress>): Promise<{ success: boolean; progress?: Progress }>;
  markComplete(lectureId: string, completed: boolean): Promise<{ success: boolean; progress?: Progress }>;
  setLectureDuration(lectureId: string, seconds: number): Promise<{ success: boolean }>;
  getActivity(): Promise<ActivityDay[]>;
  addAppActivity(seconds: number): Promise<{ success: boolean }>;

  saveNote(note: Partial<Note>): Promise<{ success: boolean; id: string }>;
  updateNote(id: string, content: string): Promise<{ success: boolean }>;
  deleteNote(id: string): Promise<{ success: boolean }>;
  getNotes(courseId?: string, lectureId?: string): Promise<Note[]>;

  addBookmark(bookmark: Partial<Bookmark>): Promise<{ success: boolean; id: string }>;
  deleteBookmark(id: string): Promise<{ success: boolean }>;
  getBookmarks(courseId?: string, lectureId?: string): Promise<Bookmark[]>;

  getSettings(): Promise<Settings>;
  setSetting(key: string, value: unknown): Promise<{ success: boolean }>;
  getStats(): Promise<Stats>;

  getFileUrl(filePath: string): Promise<string | null>;
  listSubtitlesForVideo(videoPath: string): Promise<SubtitleFile[]>;
  getSubtitleVtt(subtitlePath: string): Promise<string | null>;
  openSubtitleFile(): Promise<string | null>;
  addSubtitle(lectureId: string, subtitlePath: string): Promise<{ success: boolean; subtitle_paths?: string }>;
}

declare global {
  interface Window {
    api: Api;
  }
}
