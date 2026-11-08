import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // Window controls (frameless window)
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
  getWindowState: () => ipcRenderer.invoke('window:state'),
  onWindowState: (callback: (state: { maximized: boolean; fullscreen: boolean }) => void) => {
    const listener = (_event: unknown, state: { maximized: boolean; fullscreen: boolean }) => callback(state);
    ipcRenderer.on('window:state', listener);
    return () => ipcRenderer.removeListener('window:state', listener);
  },

  // Dialogs / app
  selectFolder: (title?: string) => ipcRenderer.invoke('dialog:selectFolder', title),
  getVersions: () => ipcRenderer.invoke('app:versions'),
  openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),
  openPath: (filePath: string) => ipcRenderer.invoke('app:openPath', filePath),
  showInFolder: (filePath: string) => ipcRenderer.invoke('app:showInFolder', filePath),

  // Backup / restore
  exportData: (preferences: Record<string, string>) => ipcRenderer.invoke('data:export', preferences),
  importData: () => ipcRenderer.invoke('data:import'),

  // Courses
  importCourse: (folderPath: string) => ipcRenderer.invoke('course:import', folderPath),
  getCourses: () => ipcRenderer.invoke('course:list'),
  getCourse: (id: string) => ipcRenderer.invoke('course:get', id),
  scanCourse: (id: string) => ipcRenderer.invoke('course:scan', id),
  deleteCourse: (id: string) => ipcRenderer.invoke('course:delete', id),
  renameCourse: (id: string, title: string) => ipcRenderer.invoke('course:rename', id, title),
  relocateCourse: (id: string, folderPath: string) => ipcRenderer.invoke('course:relocate', id, folderPath),

  // Lectures / review
  searchLectures: (query: string) => ipcRenderer.invoke('lecture:search', query),
  listReviewLectures: () => ipcRenderer.invoke('lecture:listReview'),
  setLectureReview: (lectureId: string, needsReview: boolean) => ipcRenderer.invoke('lecture:setReview', lectureId, needsReview),

  // Progress
  getProgress: () => ipcRenderer.invoke('progress:all'),
  getLectureProgress: (lectureId: string) => ipcRenderer.invoke('progress:get', lectureId),
  updateProgress: (lectureId: string, data: any) => ipcRenderer.invoke('progress:update', lectureId, data),
  markComplete: (lectureId: string, completed: boolean) => ipcRenderer.invoke('progress:complete', lectureId, completed),
  setLectureDuration: (lectureId: string, seconds: number) => ipcRenderer.invoke('lecture:setDuration', lectureId, seconds),
  getActivity: () => ipcRenderer.invoke('activity:get'),
  addAppActivity: (seconds: number) => ipcRenderer.invoke('activity:addAppTime', seconds),

  // Notes
  saveNote: (note: any) => ipcRenderer.invoke('note:save', note),
  updateNote: (id: string, content: string) => ipcRenderer.invoke('note:update', id, content),
  deleteNote: (id: string) => ipcRenderer.invoke('note:delete', id),
  getNotes: (courseId?: string, lectureId?: string) => ipcRenderer.invoke('note:list', courseId, lectureId),

  // Bookmarks
  addBookmark: (bookmark: any) => ipcRenderer.invoke('bookmark:add', bookmark),
  deleteBookmark: (id: string) => ipcRenderer.invoke('bookmark:delete', id),
  getBookmarks: (courseId?: string, lectureId?: string) => ipcRenderer.invoke('bookmark:list', courseId, lectureId),

  // Settings / stats
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key: string, value: any) => ipcRenderer.invoke('settings:set', key, value),
  getStats: () => ipcRenderer.invoke('stats:get'),

  // Files / subtitles
  getFileUrl: (filePath: string) => ipcRenderer.invoke('file:url', filePath),
  listSubtitlesForVideo: (videoPath: string) => ipcRenderer.invoke('subtitle:listForVideo', videoPath),
  getSubtitleVtt: (subtitlePath: string) => ipcRenderer.invoke('subtitle:vtt', subtitlePath),
  openSubtitleFile: () => ipcRenderer.invoke('subtitle:open'),
  addSubtitle: (lectureId: string, subtitlePath: string) => ipcRenderer.invoke('subtitle:add', lectureId, subtitlePath)
};

contextBridge.exposeInMainWorld('api', api);

declare global {
  interface Window {
    api: typeof api;
  }
}
