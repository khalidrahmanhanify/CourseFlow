import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import confetti from "canvas-confetti";
import {
  ArrowLeft,
  ArrowUpRight,
  Bookmark,
  BookmarkPlus,
  Captions,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  FileText,
  Flag,
  FolderOpen,
  Gauge,
  Keyboard,
  ListVideo,
  Loader2,
  Maximize,
  Minimize2,
  Pause,
  PictureInPicture2,
  Play,
  Plus,
  RotateCcw,
  Search,
  StickyNote,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import Modal from "../components/Modal";
import { useSectionExpansion } from "../hooks/useSectionExpansion";
import type {
  Bookmark as BookmarkType,
  CourseDetail,
  Lecture,
  Note,
  Progress,
  Settings,
  SubtitleFile,
  ToastType,
} from "../types";
import {
  cn,
  courseTimeProgress,
  flattenCourse,
  formatHours,
  formatPercent,
  formatTime,
  isComplete,
  lecturePercent,
  mergeIntervals,
  parseList,
  pluralize,
} from "../utils";

interface PlayerProps {
  data: CourseDetail;
  lectureId: string;
  settings: Settings;
  onBack: () => void;
  onNavigate: (lectureId: string) => void;
  onLecturePatch: (lectureId: string, patch: Partial<Lecture>) => void;
  onStatsRefresh: () => void;
  onSettingsChange: (patch: Partial<Settings>) => void;
  notify: (message: string, type?: ToastType) => void;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const VOLUME_KEY = "courseflow.volume";
const MUTE_KEY = "courseflow.muted";
// Any single timeupdate whose delta exceeds this many seconds is treated as a
// seek, even if the `seeking` event hasn't fired yet (Electron/Chromium can
// emit timeupdate before seeking when currentTime is assigned).
const SEEK_JUMP_THRESHOLD = 1.5;

type TabKey = "notes" | "moments" | "resources" | "subtitles";

function fileName(filePath: string) {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

function fileExtension(filePath: string) {
  const name = fileName(filePath);
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toUpperCase() : "";
}

export default function Player({
  data,
  lectureId,
  settings,
  onBack,
  onNavigate,
  onLecturePatch,
  onStatsRefresh,
  onSettingsChange,
  notify,
}: PlayerProps) {
  const flat = useMemo(() => flattenCourse(data), [data]);
  const currentIndex = useMemo(
    () => flat.findIndex((item) => item.lecture.id === lectureId),
    [flat, lectureId],
  );
  const entry = currentIndex >= 0 ? flat[currentIndex] : null;
  const lecture = entry?.lecture;
  const section = entry?.section;
  const prevEntry = currentIndex > 0 ? flat[currentIndex - 1] : null;
  const nextEntry =
    currentIndex >= 0 && currentIndex < flat.length - 1
      ? flat[currentIndex + 1]
      : null;

  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const noteInputRef = useRef<HTMLTextAreaElement>(null);
  const playlistScrollRef = useRef<HTMLDivElement | null>(null);
  const currentRowRef = useRef<HTMLDivElement | null>(null);
  const menusRef = useRef<HTMLDivElement>(null);
  const hideControlsTimer = useRef<number | null>(null);
  const lastSavedRef = useRef(0);
  const resumeAppliedRef = useRef(false);
  const autoCompletedRef = useRef(false);
  const autoplayNavigatedRef = useRef(false);
  const completedRef = useRef(false);
  // An explicit "not complete" is sticky: threshold auto-complete must not undo
  // it until the user marks the lecture complete again.
  const autoCompleteBlockedRef = useRef(false);
  // Suppress saves while a completion change is in flight so an older local
  // range set cannot overwrite the coverage the server just restored.
  const suspendSavesRef = useRef(false);
  // Which lecture the media element currently holds. Guards against the
  // outgoing video firing pause/timeupdate after the user switched lectures.
  const mediaLectureIdRef = useRef<string | null>(null);
  const progressSeqRef = useRef(0);

  // ---- Watched-coverage tracking refs ----
  const intervalsRef = useRef<Array<[number, number]>>([]);
  const currentIntervalStartRef = useRef<number | null>(null);
  const intervalActiveRef = useRef(false);
  const watchedRef = useRef(0);

  // Tracks the last position reported by timeupdate / seeked so we can detect
  // a scrub whose timeupdate fires before the `seeking` event.
  const lastTickRef = useRef<number>(0);
  const seekingRef = useRef(false);
  const seekResetTimer = useRef<number | null>(null);

  const closeCurrentInterval = useCallback((end?: number) => {
    if (currentIntervalStartRef.current !== null) {
      const start = currentIntervalStartRef.current;
      const video = videoRef.current;
      const e =
        typeof end === "number" ? end : video ? video.currentTime : start;
      if (e > start + 0.01) {
        intervalsRef.current.push([start, e]);
      } else if (e >= start) {
        intervalsRef.current.push([start, Math.max(start, e)]);
      }
      currentIntervalStartRef.current = null;
      intervalActiveRef.current = false;
    }
  }, []);

  // Capture the position BEFORE the seek is applied. Closing the open interval
  // at the new position would count the skipped range as watched.
  const markSeeking = useCallback(
    (fromPosition?: number) => {
      const video = videoRef.current;
      const closeAt =
        typeof fromPosition === "number"
          ? fromPosition
          : video
            ? video.currentTime
            : undefined;
      closeCurrentInterval(closeAt);
      seekingRef.current = true;
      if (seekResetTimer.current) window.clearTimeout(seekResetTimer.current);
      // Fallback for the rare case where `seeked` never fires (e.g. when the
      // requested position equals the current one).
      seekResetTimer.current = window.setTimeout(() => {
        seekingRef.current = false;
        seekResetTimer.current = null;
      }, 1200);
    },
    [closeCurrentInterval],
  );

  const clearSeeking = useCallback(() => {
    seekingRef.current = false;
    if (seekResetTimer.current) {
      window.clearTimeout(seekResetTimer.current);
      seekResetTimer.current = null;
    }
  }, []);

  const savedPosition = Number(lecture?.progress?.position || 0);
  const initialCompleted = Boolean(lecture && isComplete(lecture));
  const initialReview = lecture?.needs_review === 1;

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => {
    const stored = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(stored) && stored > 0 ? Math.min(1, stored) : 0.85;
  });
  const [muted, setMuted] = useState(
    () => localStorage.getItem(MUTE_KEY) === "1",
  );
  const [rate, setRate] = useState(settings.playbackRate || 1);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [openMenu, setOpenMenu] = useState<"speed" | "captions" | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [completed, setCompleted] = useState(initialCompleted);
  const [showCompletion, setShowCompletion] = useState(false);
  const completionWatchedRef = useRef<number>(0);
  const [review, setReview] = useState(initialReview);
  const [resumeNotice, setResumeNotice] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(6);

  const [subtitles, setSubtitles] = useState<SubtitleFile[]>([]);
  const [selectedSubtitle, setSelectedSubtitle] = useState<string | null>(null);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [trackUrl, setTrackUrl] = useState<string | null>(null);
  // Caption appearance is a global preference, edited in Settings. The player
  // only toggles captions and chooses/imports subtitle files.
  const captionSize = Number(settings.captionSize) || 100;
  const captionColor = settings.captionColor || "#ffffff";
  const captionBg = Number.isFinite(Number(settings.captionBg))
    ? Number(settings.captionBg)
    : 55;

  const [notes, setNotes] = useState<Note[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const [moments, setMoments] = useState<BookmarkType[]>([]);
  const [momentLabel, setMomentLabel] = useState("");
  const [tab, setTab] = useState<TabKey>("notes");
  const [playlistQuery, setPlaylistQuery] = useState("");
  const [showShortcuts, setShowShortcuts] = useState(false);

  const sectionIds = useMemo(
    () => data.sections.map((item) => item.id),
    [data.sections],
  );
  const sectionExpansion = useSectionExpansion(
    data.course.id,
    sectionIds,
    section?.id ?? null,
  );

  const resources = useMemo(
    () => (lecture ? parseList(lecture.resources) : []),
    [lecture],
  );
  const lectureSubtitles = useMemo(
    () => (lecture ? parseList(lecture.subtitle_paths) : []),
    [lecture],
  );

  const completedCount = useMemo(
    () => flat.filter((item) => isComplete(item.lecture)).length,
    [flat],
  );
  const courseTime = useMemo(
    () => courseTimeProgress(data.sections),
    [data.sections],
  );
  const courseProgress = courseTime.percent;

  const requestedTab = tab;
  const activeTab: TabKey =
    (requestedTab === "resources" && resources.length === 0) ||
    (requestedTab === "subtitles" &&
      lectureSubtitles.length === 0 &&
      subtitles.length === 0)
      ? "notes"
      : requestedTab;

  // -------------------------------------------------------------------------
  // Load the lecture media, subtitles, notes and bookmarks
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!lecture) return;
    let cancelled = false;
    // Invalidate the media binding before pausing: the outgoing video's pause
    // event fires after this effect and must not save into the new lecture.
    mediaLectureIdRef.current = null;
    videoRef.current?.pause();
    try {
      closeCurrentInterval();
    } catch {}
    intervalsRef.current = [];
    currentIntervalStartRef.current = null;
    intervalActiveRef.current = false;
    watchedRef.current = 0;
    lastTickRef.current = 0;
    setVideoUrl(null);
    setMediaLoading(true);
    setLoadError(false);
    setEnded(false);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setNotes([]);
    setMoments([]);
    setNoteDraft("");
    setMomentLabel("");
    setEditingNoteId(null);
    setSubtitles([]);
    setSelectedSubtitle(null);
    setCaptionsOn(false);
    setTrackUrl(null);
    setResumeNotice(null);
    resumeAppliedRef.current = false;
    autoCompletedRef.current = false;
    autoCompleteBlockedRef.current =
      Number(lecture.progress?.auto_complete_blocked) === 1;
    suspendSavesRef.current = false;
    seekingRef.current = false;
    if (seekResetTimer.current) {
      window.clearTimeout(seekResetTimer.current);
      seekResetTimer.current = null;
    }
    progressSeqRef.current += 1;
    completedRef.current = isComplete(lecture);
    setCompleted(completedRef.current);
    setReview(lecture.needs_review === 1);
    setTab("notes");

    window.api.getFileUrl(lecture.file_path).then((url) => {
      if (cancelled) return;
      if (!url) {
        setLoadError(true);
        setMediaLoading(false);
      } else {
        setVideoUrl(url);
      }
    });

    window.api.listSubtitlesForVideo(lecture.file_path).then((found) => {
      if (cancelled) return;
      setSubtitles(found);
      const preferred =
        found.find((item) => item.matched) ??
        found.find((item) => !/\.(ass|ssa)$/i.test(item.path));
      if (preferred) setSelectedSubtitle(preferred.path);
    });

    window.api.getNotes(undefined, lecture.id).then((loaded) => {
      if (!cancelled) setNotes(loaded);
    });

    window.api.getBookmarks(undefined, lecture.id).then((loaded) => {
      if (!cancelled) setMoments(loaded);
    });

    // Recover the authoritative progress from the database.
    window.api
      .getLectureProgress(lecture.id)
      .then((saved) => {
        if (cancelled || !saved) return;
        completedRef.current = Number(saved.completed) === 1;
        autoCompleteBlockedRef.current =
          Number(saved.auto_complete_blocked) === 1;
        setCompleted(completedRef.current);
        // Restore interval coverage so an interrupted session continues from the
        // real watched set instead of starting at zero.
        try {
          const parsed = saved.intervals ? JSON.parse(saved.intervals) : null;
          if (Array.isArray(parsed)) {
            intervalsRef.current = parsed as Array<[number, number]>;
          }
        } catch {
          /* ignore malformed intervals */
        }
        onLecturePatch(lecture.id, {
          duration: Number(lecture.duration) || Number(saved.duration) || null,
          progress: saved,
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
    // Progress patches replace the lecture object but must not reload the
    // video. Only an actual lecture change restarts the media pipeline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lectureId, lecture?.file_path]);

  // Keep the current lecture visible in the playlist without scrolling the
  // whole page.
  useEffect(() => {
    const scroll = playlistScrollRef.current;
    const row = currentRowRef.current;
    if (!scroll || !row) return;
    const frame = window.requestAnimationFrame(() => {
      const scrollRect = scroll.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      if (rowRect.top < scrollRect.top + 24) {
        scroll.scrollTo({
          top: Math.max(
            0,
            scroll.scrollTop + rowRect.top - scrollRect.top - 24,
          ),
          behavior: "smooth",
        });
      } else if (rowRect.bottom > scrollRect.bottom - 24) {
        scroll.scrollTo({
          top: scroll.scrollTop + rowRect.bottom - scrollRect.bottom + 24,
          behavior: "smooth",
        });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [lectureId, sectionExpansion.isExpanded(section?.id ?? "")]);

  // Close the speed / captions menus when clicking elsewhere.
  useEffect(() => {
    if (!openMenu) return;
    const close = (event: MouseEvent) => {
      if (!menusRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [openMenu]);

  // Track fullscreen state so the button icon stays accurate.
  useEffect(() => {
    const onFullscreenChange = () =>
      setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // Convert the selected subtitle to WebVTT in the main process.
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setTrackUrl(null);
    if (!selectedSubtitle) return;

    window.api.getSubtitleVtt(selectedSubtitle).then((vtt) => {
      if (cancelled || !vtt) return;
      objectUrl = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
      setTrackUrl(objectUrl);
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selectedSubtitle]);

  // Apply caption visibility once the track is available.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const track = video.textTracks[0];
    if (!track) return;
    track.mode = captionsOn && trackUrl ? "showing" : "hidden";
  }, [captionsOn, trackUrl, duration]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
    localStorage.setItem(VOLUME_KEY, String(volume));
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  }, [volume, muted]);

  // -------------------------------------------------------------------------
  // Progress persistence
  // -------------------------------------------------------------------------
  const persistProgress = useCallback(
    (options?: { completed?: boolean; silent?: boolean }) => {
      const video = videoRef.current;
      if (!video || !lecture) return;
      if (mediaLectureIdRef.current !== lecture.id) return;
      if (suspendSavesRef.current) return;
      const total = Number.isFinite(video.duration) ? video.duration : 0;
      if (total <= 0) return;
      const position = Math.min(total, Math.max(0, video.currentTime || 0));
      const currentPercent =
        total > 0 ? Math.min(100, Math.max(0, (position / total) * 100)) : 0;
      const watched = (currentPercent / 100) * total;
      // A sticky "not complete" wins over the threshold until the user marks
      // the lecture complete again.
      const finished =
        completedRef.current ||
        (!autoCompleteBlockedRef.current &&
          (Boolean(options?.completed) ||
            currentPercent >= settings.completionThreshold));
      const percent = finished ? 100 : currentPercent;
      const watchedFinal = finished ? total : watched;
      lastSavedRef.current = position;
      watchedRef.current = watchedFinal;
      const seq = ++progressSeqRef.current;
      const optimistic: Progress = {
        lecture_id: lecture.id,
        position,
        duration: total,
        percent,
        watched: watchedFinal,
        completed: finished ? 1 : 0,
        auto_complete_blocked: autoCompleteBlockedRef.current ? 1 : 0,
        last_watched: Date.now(),
        intervals: "[]",
      };
      onLecturePatch(lecture.id, {
        duration: Number(lecture.duration) || Math.round(total),
        progress: optimistic,
      });
      window.api
        .updateProgress(lecture.id, {
          position,
          duration: total,
          watched: watchedFinal,
          percent,
          completed: finished ? 1 : 0,
          intervals: [],
          clientTime: Date.now(),
        })
        .then((result) => {
          if (seq !== progressSeqRef.current || !result?.progress) return;
          autoCompleteBlockedRef.current =
            Number(result.progress.auto_complete_blocked) === 1;
          onLecturePatch(lecture.id, { progress: result.progress });
        })
        .catch(() => undefined);
    },
    [lecture, onLecturePatch, settings.completionThreshold],
  );

  const persistProgressRef = useRef(persistProgress);
  useEffect(() => {
    persistProgressRef.current = persistProgress;
  }, [persistProgress]);

  useEffect(() => {
    const onHide = () => persistProgressRef.current();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onHide);
      persistProgressRef.current();
    };
  }, []);

  // -------------------------------------------------------------------------
  // Completion / review
  // -------------------------------------------------------------------------
  const applyCompleted = useCallback(
    async (next: boolean, announce = true) => {
      if (!lecture) return;
      progressSeqRef.current += 1;
      const wasComplete = completedRef.current;
      completedRef.current = next;
      autoCompleteBlockedRef.current = !next;
      autoCompletedRef.current = true;
      suspendSavesRef.current = true;
      const total =
        Number(videoRef.current?.duration) ||
        Number(lecture.progress?.duration) ||
        0;
      setCompleted(next);

      // Un-marking must drop the watched coverage so the persisted percent
      // reflects reality. Without this, seeks previously kept the full-range
      // interval alive and the lecture stayed stuck at ~94%.
      if (!next) {
        intervalsRef.current = [];
        currentIntervalStartRef.current = null;
        intervalActiveRef.current = false;
        watchedRef.current = 0;
      } else {
        watchedRef.current = total;
      }

      try {
        const saved = await window.api.markComplete(lecture.id, next);
        if (saved?.progress) {
          autoCompleteBlockedRef.current =
            Number(saved.progress.auto_complete_blocked) === 1;
          if (saved.progress.intervals && next) {
            try {
              const parsed = JSON.parse(saved.progress.intervals);
              if (Array.isArray(parsed)) intervalsRef.current = parsed;
            } catch {}
          }
          onLecturePatch(lecture.id, { progress: saved.progress });
        } else {
          const current = lecture.progress ?? {
            position: 0,
            duration: 0,
            percent: 0,
            watched: 0,
            last_watched: null,
            completed: 0,
          };
          const pos = current.position || 0;
          const pct = next
            ? 100
            : total > 0
              ? Math.min(100, Math.max(0, (pos / total) * 100))
              : current.percent;
          const w = next ? total : pos;
          onLecturePatch(lecture.id, {
            progress: {
              ...current,
              percent: pct,
              watched: w,
              intervals: next ? current.intervals : "[]",
              completed: next ? 1 : 0,
              auto_complete_blocked: next ? 0 : 1,
            },
          });
        }
      } finally {
        suspendSavesRef.current = false;
      }

      if (next) persistProgressRef.current();

      onStatsRefresh();
      if (announce) {
        notify(
          next
            ? "Lecture marked as complete"
            : "Lecture marked as not complete",
          next ? "success" : "info",
        );
      }
      if (next) {
        try {
          const video = videoRef.current;
          if (video && !video.paused) {
            video.pause();
            setPlaying(false);
          }
        } catch {
          // ignore
        }
        try {
          confetti({ particleCount: 120, spread: 85, origin: { y: 0.6 } });
        } catch {
          // ignore
        }
        if (!wasComplete) {
          const video = videoRef.current;
          const totalSnap = Number(video?.duration) || Number(lecture.progress?.duration) || watchedRef.current || 0;
          completionWatchedRef.current = totalSnap > 0 ? totalSnap : watchedRef.current;
          setShowCompletion(true);
        }
      }
    },
    [lecture, notify, onLecturePatch, onStatsRefresh],
  );

  const applyReview = useCallback(
    async (next: boolean) => {
      if (!lecture) return;
      setReview(next);
      await window.api.setLectureReview(lecture.id, next);
      onLecturePatch(lecture.id, { needs_review: next ? 1 : 0 });
      onStatsRefresh();
      notify(
        next ? "Saved for review later" : "Removed from review later",
        next ? "info" : "success",
      );
    },
    [lecture, notify, onLecturePatch, onStatsRefresh],
  );

  // -------------------------------------------------------------------------
  // Media controls
  // -------------------------------------------------------------------------
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      setEnded(false);
      video.play().catch(() => setLoadError(true));
    } else {
      video.pause();
    }
  }, []);

  const seekBy = useCallback(
    (seconds: number) => {
      const video = videoRef.current;
      if (!video) return;
      // Capture PRE-seek position so the interval is closed at the old spot.
      markSeeking(video.currentTime);
      const target = Math.min(
        Math.max(0, video.currentTime + seconds),
        video.duration || 0,
      );
      video.currentTime = target;
      lastTickRef.current = target;
      setCurrentTime(target);
    },
    [markSeeking],
  );

  const changeRate = useCallback(
    (next: number) => {
      setRate(next);
      setOpenMenu(null);
      if (videoRef.current) videoRef.current.playbackRate = next;
      onSettingsChange({ playbackRate: next });
    },
    [onSettingsChange],
  );

  const changeVolume = useCallback((next: number) => {
    const clamped = Math.min(1, Math.max(0, next));
    setVolume(clamped);
    setMuted(clamped === 0);
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((value) => !value);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
      return;
    }
    frameRef.current?.requestFullscreen().catch(() => undefined);
  }, []);

  const togglePictureInPicture = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
      } else {
        notify("Picture-in-picture is not available", "error");
      }
    } catch {
      notify("Picture-in-picture is not available", "error");
    }
  }, [notify]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimer.current)
      window.clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused)
        setControlsVisible(false);
    }, 2600);
  }, []);

  useEffect(() => {
    if (!playing) {
      setControlsVisible(true);
      if (hideControlsTimer.current)
        window.clearTimeout(hideControlsTimer.current);
    } else {
      revealControls();
    }
    return () => {
      if (hideControlsTimer.current)
        window.clearTimeout(hideControlsTimer.current);
    };
  }, [playing, revealControls]);

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    mediaLectureIdRef.current = lectureId;
    const total = Number.isFinite(video.duration) ? video.duration : 0;
    setDuration(total);
    setMediaLoading(false);
    video.volume = volume;
    video.muted = muted;
    video.playbackRate = rate;

    if (!resumeAppliedRef.current) {
      resumeAppliedRef.current = true;
      if (savedPosition > 3 && savedPosition < total - 5) {
        // Capture PRE-seek position (metadata fires at 0, but this also
        // covers the "resume after reload" case where currentTime > 0).
        markSeeking(video.currentTime);
        video.currentTime = savedPosition;
        lastTickRef.current = savedPosition;
        setCurrentTime(savedPosition);
        setResumeNotice(savedPosition);
        window.setTimeout(() => setResumeNotice(null), 6000);
      }
    }

    const track = video.textTracks[0];
    if (track) track.mode = captionsOn && trackUrl ? "showing" : "hidden";
  };

  const watchedPercent = (video: HTMLVideoElement) => {
    const total = Number.isFinite(video.duration) ? video.duration : 0;
    if (total <= 0) return 0;
    if (completedRef.current) return 100;
    const pos = Math.min(total, Math.max(0, video.currentTime || 0));
    return Math.min(100, Math.max(0, (pos / total) * 100));
  };

  const maybeAutoComplete = (video: HTMLVideoElement) => {
    if (
      !completedRef.current &&
      !autoCompletedRef.current &&
      !autoCompleteBlockedRef.current &&
      watchedPercent(video) >= settings.completionThreshold
    ) {
      autoCompletedRef.current = true;
      applyCompleted(true, false);
      notify("Nice! This lecture is now marked complete", "success");
    }
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    if (mediaLectureIdRef.current !== lectureId) return;

    // If user seeks back before the end, dismiss the ended/up-next overlay.
    if (ended && video.currentTime < (duration || video.duration || 0) - 0.5) {
      setEnded(false);
      setCountdown(6);
      autoplayNavigatedRef.current = false;
    }

    // Delta-guard: if the position jumped more than a normal tick, this is a
    // seek whose `seeking` event hasn't fired yet. Close the interval at the
    // PREVIOUS position and do NOT count the jump as watched time.
    const prev = lastTickRef.current;
    const delta = Math.abs(video.currentTime - prev);
    if (!seekingRef.current && delta > SEEK_JUMP_THRESHOLD) {
      markSeeking(prev);
      lastTickRef.current = video.currentTime;
      setCurrentTime(video.currentTime);
      return;
    }

    setCurrentTime(video.currentTime);
    watchedRef.current = video.currentTime;

    if (!video.paused && !seekingRef.current) {
      if (currentIntervalStartRef.current === null) {
        currentIntervalStartRef.current = video.currentTime;
        intervalActiveRef.current = true;
      }
    } else if (seekingRef.current && currentIntervalStartRef.current !== null) {
      closeCurrentInterval(video.currentTime);
    }

    lastTickRef.current = video.currentTime;
    if (Math.abs(video.currentTime - lastSavedRef.current) >= 1)
      persistProgress();
    maybeAutoComplete(video);
  };

  const replayLecture = () => {
    const video = videoRef.current;
    if (!video) return;
    setEnded(false);
    markSeeking(video.currentTime);
    video.currentTime = 0;
    lastTickRef.current = 0;
    setCurrentTime(0);
    video.play().catch(() => undefined);
  };

  const handleEnded = () => {
    const video = videoRef.current;
    setEnded(true);
    setPlaying(false);
    setControlsVisible(true);
    if (video && mediaLectureIdRef.current === lectureId) {
      // Playback ending only completes the lecture if enough of it was really
      // watched — dragging the scrubber to the end must not count. An explicit
      // un-mark also stays un-completed.
      const enoughWatched =
        watchedPercent(video) >= settings.completionThreshold;
      const shouldComplete = enoughWatched && !autoCompleteBlockedRef.current;
      lastSavedRef.current = video.currentTime;
      persistProgress({ completed: shouldComplete });
      if (shouldComplete && !completedRef.current) {
        autoCompletedRef.current = true;
        applyCompleted(true, false);
        notify("Lecture complete. Nicely done!", "success");
      } else if (shouldComplete && completedRef.current) {
        try {
          confetti({ particleCount: 60, spread: 60, origin: { y: 0.7 } });
        } catch {
          // ignore
        }
      }
    }
    setCountdown(6);
    autoplayNavigatedRef.current = false;
  };

  // Autoplay the next lecture with a visible countdown.
  useEffect(() => {
    if (!ended || !nextEntry || !settings.autoplay) return;
    if (countdown <= 0) {
      if (autoplayNavigatedRef.current) return;
      autoplayNavigatedRef.current = true;
      onNavigate(nextEntry.lecture.id);
      return;
    }
    const timer = window.setTimeout(
      () => setCountdown((value) => value - 1),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [ended, nextEntry, settings.autoplay, countdown, onNavigate]);

  // -------------------------------------------------------------------------
  // Notes & moments
  // -------------------------------------------------------------------------
  const addNote = async () => {
    if (!lecture || !noteDraft.trim()) return;
    setSavingNote(true);
    try {
      await window.api.saveNote({
        course_id: lecture.course_id,
        lecture_id: lecture.id,
        timestamp: currentTime,
        content: noteDraft.trim(),
      });
      setNoteDraft("");
      setNotes(await window.api.getNotes(undefined, lecture.id));
      notify("Note saved", "success");
    } finally {
      setSavingNote(false);
    }
  };

  const saveNoteEdit = async (note: Note) => {
    if (!editingNoteText.trim()) return;
    await window.api.updateNote(note.id, editingNoteText.trim());
    setNotes((current) =>
      current.map((item) =>
        item.id === note.id
          ? { ...item, content: editingNoteText.trim() }
          : item,
      ),
    );
    setEditingNoteId(null);
    setEditingNoteText("");
    notify("Note updated", "success");
  };

  const deleteNote = async (note: Note) => {
    await window.api.deleteNote(note.id);
    setNotes((current) => current.filter((item) => item.id !== note.id));
    notify("Note deleted", "info");
  };

  const addMoment = async () => {
    if (!lecture) return;
    const description =
      momentLabel.trim() || `Moment at ${formatTime(currentTime)}`;
    const result = await window.api.addBookmark({
      course_id: lecture.course_id,
      lecture_id: lecture.id,
      timestamp: currentTime,
      description,
    });
    setMomentLabel("");
    setMoments(await window.api.getBookmarks(undefined, lecture.id));
    notify(`Saved “${description}”`, "success");
    void result;
  };

  const deleteMoment = async (moment: BookmarkType) => {
    await window.api.deleteBookmark(moment.id);
    setMoments((current) => current.filter((item) => item.id !== moment.id));
    notify("Moment removed", "info");
  };

  const jumpTo = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    markSeeking(video.currentTime);
    video.currentTime = seconds;
    lastTickRef.current = seconds;
    setCurrentTime(seconds);
    if (video.paused) video.play().catch(() => undefined);
  };

  const openSubtitle = (subtitle: SubtitleFile) => {
    const extension = subtitle.path.toLowerCase();
    if (extension.endsWith(".ass") || extension.endsWith(".ssa")) {
      notify(
        "ASS/SSA subtitles are not supported. Convert to SRT or VTT.",
        "error",
      );
      return;
    }
    setSelectedSubtitle(subtitle.path);
    setCaptionsOn(true);
    notify(`Subtitles: ${subtitle.name}`, "info");
  };

  const addSubtitleFile = async () => {
    if (!lecture) return;
    const picked = await window.api.openSubtitleFile();
    if (!picked) return;
    const result = await window.api.addSubtitle(lecture.id, picked);
    if (!result?.success) return;
    if (result.subtitle_paths)
      onLecturePatch(lecture.id, { subtitle_paths: result.subtitle_paths });
    const found = await window.api.listSubtitlesForVideo(lecture.file_path);
    setSubtitles(found);
    setSelectedSubtitle(picked);
    setCaptionsOn(true);
    notify("Subtitle added", "success");
  };

  // -------------------------------------------------------------------------
  // Keyboard shortcuts
  // -------------------------------------------------------------------------
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable;
      if (typing) {
        if (event.key === "Escape") target.blur();
        return;
      }
      if (showShortcuts) return;

      const key = event.key.toLowerCase();

      // Handle Ctrl/Cmd shortcuts first
      if (event.ctrlKey || event.metaKey) {
        if (event.altKey) return;
        if (key === "arrowleft") {
          event.preventDefault();
          if (prevEntry) onNavigate(prevEntry.lecture.id);
          return;
        }
        if (key === "arrowright") {
          event.preventDefault();
          if (nextEntry) onNavigate(nextEntry.lecture.id);
          return;
        }
        if (key === "enter") {
          event.preventDefault();
          if (lecture && !completed) {
            applyCompleted(true, true);
          } else if (lecture && completed) {
            applyCompleted(false, true);
          }
          return;
        }
        return;
      }

      if (event.altKey) return;

      switch (key) {
        case " ":
        case "k":
          event.preventDefault();
          togglePlay();
          break;
        case "arrowleft":
          event.preventDefault();
          seekBy(event.shiftKey ? -30 : -5);
          break;
        case "arrowright":
          event.preventDefault();
          seekBy(event.shiftKey ? 30 : 5);
          break;
        case "j":
          event.preventDefault();
          seekBy(-10);
          break;
        case "l":
          event.preventDefault();
          seekBy(10);
          break;
        case "arrowup":
          event.preventDefault();
          changeVolume(volume + 0.05);
          break;
        case "arrowdown":
          event.preventDefault();
          changeVolume(volume - 0.05);
          break;
        case "m":
          toggleMute();
          break;
        case "f":
          event.preventDefault();
          toggleFullscreen();
          break;
        case "c":
          setCaptionsOn((value) => !value);
          break;
        case "p":
          togglePictureInPicture();
          break;
        case "n":
          if (event.shiftKey) {
            if (nextEntry) onNavigate(nextEntry.lecture.id);
          } else {
            event.preventDefault();
            setTab("notes");
            window.setTimeout(() => noteInputRef.current?.focus(), 60);
          }
          break;
        case "b":
          event.preventDefault();
          addMoment();
          break;
        case "[":
          changeRate(SPEEDS[Math.max(0, SPEEDS.indexOf(rate) - 1)] ?? 1);
          break;
        case "]":
          changeRate(
            SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(rate) + 1)] ?? 1,
          );
          break;
        case "?":
          setShowShortcuts(true);
          break;
        default:
          break;
      }
    },
    [
      showShortcuts,
      togglePlay,
      seekBy,
      changeVolume,
      volume,
      toggleMute,
      toggleFullscreen,
      togglePictureInPicture,
      prevEntry,
      nextEntry,
      onNavigate,
      rate,
      changeRate,
      lecture,
      completed,
      applyCompleted,
    ],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  if (!lecture || !entry) {
    return (
      <div className="page player-page">
        <div className="empty-panel">
          <FileText size={24} />
          <h3>Lecture not found</h3>
          <p>It may have been removed from this course.</p>
          <button className="btn btn-primary" onClick={onBack}>
            Back to course
          </button>
        </div>
      </div>
    );
  }

  const seekPercent =
    duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const playlistSections = data.sections
    .map((item) => {
      const q = playlistQuery.trim().toLowerCase();
      if (!q) return item;
      return {
        ...item,
        lectures: item.lectures.filter(
          (row) =>
            row.title.toLowerCase().includes(q) ||
            item.title.toLowerCase().includes(q),
        ),
      };
    })
    .filter((item) => item.lectures.length > 0);

  const tabs: Array<{
    key: TabKey;
    label: string;
    icon: typeof StickyNote;
    count?: number;
  }> = [
    { key: "notes", label: "Notes", icon: StickyNote, count: notes.length },
    { key: "moments", label: "Moments", icon: Bookmark, count: moments.length },
    {
      key: "resources",
      label: "Resources",
      icon: FileText,
      count: resources.length,
    },
    {
      key: "subtitles",
      label: "Subtitles",
      icon: Captions,
      count: lectureSubtitles.length || subtitles.length,
    },
  ];

  return (
    <div className="page player-page">
      <div className="player-topbar">
        <button className="back-link" onClick={onBack}>
          <ArrowLeft size={16} /> Back to course
        </button>
        <div className="player-breadcrumb">
          <span>{data.course.title}</span>
          <ChevronRight size={12} />
          <span>{section?.title}</span>
          <ChevronRight size={12} />
          <strong>{lecture.title}</strong>
        </div>
        <div className="player-topbar-actions">
          <button
            className="icon-btn"
            onClick={() => setShowShortcuts(true)}
            title="Keyboard shortcuts (?)"
          >
            <Keyboard size={17} />
          </button>
          <span className="player-index">
            Lecture {currentIndex + 1} / {flat.length}
          </span>
        </div>
      </div>

      <div className="player-layout">
        <div className="player-main">
          <div
            ref={frameRef}
            className={cn(
              "video-frame",
              !controlsVisible && playing && "controls-hidden",
            )}
            onMouseMove={revealControls}
            onMouseLeave={() => {
              if (playing) setControlsVisible(false);
            }}
          >
            {loadError ? (
              <div className="video-error">
                <FileText size={26} />
                <h3>This video could not be played</h3>
                <p>
                  The file may be missing or use a format Electron cannot
                  decode.
                </p>
                <div className="video-error-actions">
                  <button
                    className="btn btn-primary"
                    onClick={() => window.api.openPath(lecture.file_path)}
                  >
                    <ArrowUpRight size={15} /> Open in default player
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => window.api.showInFolder(lecture.file_path)}
                  >
                    <FolderOpen size={15} /> Show in folder
                  </button>
                </div>
              </div>
            ) : (
              <>
                <style>{`.video-frame video::cue { font-size: ${captionSize}%; color: ${captionColor}; background: rgba(0,0,0,${captionBg / 100}); }`}</style>
                <video
                  ref={videoRef}
                  className="video-el"
                  src={videoUrl ?? undefined}
                  preload="metadata"
                  playsInline
                  onClick={togglePlay}
                  onDoubleClick={toggleFullscreen}
                  onLoadedMetadata={handleLoadedMetadata}
                  onTimeUpdate={handleTimeUpdate}
                  onPlay={() => {
                    const video = videoRef.current;
                    if (video) {
                      lastTickRef.current = video.currentTime;
                      if (!seekingRef.current) {
                        if (currentIntervalStartRef.current === null) {
                          currentIntervalStartRef.current = video.currentTime;
                          intervalActiveRef.current = true;
                        }
                      }
                    }
                    setPlaying(true);
                  }}
                  onPause={() => {
                    const video = videoRef.current;
                    if (video) closeCurrentInterval(video.currentTime);
                    setPlaying(false);
                    persistProgress();
                  }}
                  onSeeking={() => {
                    const video = videoRef.current;
                    if (video) markSeeking(video.currentTime);
                    if (video) lastTickRef.current = video.currentTime;
                  }}
                  onSeeked={() => {
                    const video = videoRef.current;
                    clearSeeking();
                    if (video) {
                      lastTickRef.current = video.currentTime;
                      if (ended && video.currentTime < (duration || video.duration || 0) - 0.5) {
                        setEnded(false);
                        setCountdown(6);
                        autoplayNavigatedRef.current = false;
                      }
                    }
                    persistProgress();
                    if (video) maybeAutoComplete(video);
                  }}
                  onEnded={handleEnded}
                  onError={() => {
                    setLoadError(true);
                    setMediaLoading(false);
                  }}
                >
                  {trackUrl && (
                    <track
                      key={trackUrl}
                      kind="subtitles"
                      src={trackUrl}
                      default
                      label="Subtitles"
                    />
                  )}
                </video>
                {(!videoUrl || mediaLoading) && (
                  <div className="video-loading">
                    <Loader2 size={24} className="spin" />
                    <span>Loading video...</span>
                  </div>
                )}
              </>
            )}

            {videoUrl && !playing && !ended && !loadError && (
              <button
                className="big-play"
                onClick={togglePlay}
                aria-label="Play lecture"
              >
                <Play size={30} fill="currentColor" />
              </button>
            )}

            {resumeNotice !== null && !ended && (
              <div className="resume-pill">
                <RotateCcw size={13} /> Resumed from {formatTime(resumeNotice)}
              </div>
            )}

            {ended && (
              <div className="ended-overlay">
                <div className="ended-card">
                  <span className="ended-kicker">
                    {nextEntry ? (
                      <>
                        <ListVideo size={14} /> Up next
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={14} /> Lecture finished
                      </>
                    )}
                  </span>
                  <h3>
                    {nextEntry
                      ? nextEntry.lecture.title
                      : "You reached the end of this course"}
                  </h3>
                  {nextEntry ? (
                    <p>
                      {settings.autoplay
                        ? `Playing in ${countdown} second${countdown === 1 ? "" : "s"}`
                        : "Autoplay is off. Choose what to do next."}
                    </p>
                  ) : (
                    <p>Every lecture in this course is now behind you.</p>
                  )}
                  <div className="ended-actions">
                    <button className="btn btn-ghost" onClick={replayLecture}>
                      <RotateCcw size={15} /> Replay lecture
                    </button>
                    {nextEntry && (
                      <button
                        className="btn btn-primary"
                        onClick={() => onNavigate(nextEntry.lecture.id)}
                      >
                        Next lecture <ChevronRight size={15} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {videoUrl && (
              <div className="video-controls" ref={menusRef}>
                <div className="seek-row">
                  <input
                    type="range"
                    className="seek-bar"
                    min={0}
                    max={duration || 0}
                    step={0.1}
                    value={Math.min(currentTime, duration || 0)}
                    style={
                      { "--seek-progress": `${seekPercent}%` } as CSSProperties
                    }
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      const video = videoRef.current;
                      if (video) {
                        // Capture PRE-seek position, then jump.
                        markSeeking(video.currentTime);
                        video.currentTime = next;
                        lastTickRef.current = next;
                      }
                      setCurrentTime(next);
                    }}
                    aria-label="Seek"
                  />
                </div>

                <div className="controls-row">
                  <button
                    className="ctrl-btn ctrl-primary"
                    onClick={togglePlay}
                    title={playing ? "Pause (Space)" : "Play (Space)"}
                  >
                    {playing ? (
                      <Pause size={19} fill="currentColor" />
                    ) : (
                      <Play size={19} fill="currentColor" />
                    )}
                  </button>
                  <button
                    className="ctrl-btn"
                    onClick={() => seekBy(-10)}
                    title="Back 10s (J)"
                  >
                    <RotateCcw size={17} />
                  </button>
                  <button
                    className="ctrl-btn"
                    onClick={() => seekBy(10)}
                    title="Forward 10s (L)"
                  >
                    <RotateCcw size={17} className="flip-horizontal" />
                  </button>

                  <div className="volume-wrap">
                    <button
                      className="ctrl-btn"
                      onClick={toggleMute}
                      title="Mute (M)"
                    >
                      {muted || volume === 0 ? (
                        <VolumeX size={18} />
                      ) : (
                        <Volume2 size={18} />
                      )}
                    </button>
                    <input
                      type="range"
                      className="volume-bar"
                      min={0}
                      max={1}
                      step={0.01}
                      value={muted ? 0 : volume}
                      style={
                        {
                          "--seek-progress": `${(muted ? 0 : volume) * 100}%`,
                        } as CSSProperties
                      }
                      onChange={(event) =>
                        changeVolume(Number(event.target.value))
                      }
                      aria-label="Volume"
                    />
                  </div>

                  <span className="time-display">
                    {formatTime(currentTime)}{" "}
                    <span>/ {formatTime(duration)}</span>
                  </span>

                  <div className="controls-spacer" />

                  <button
                    className="ctrl-btn"
                    onClick={addMoment}
                    title="Save moment (B)"
                  >
                    <BookmarkPlus size={18} />
                  </button>

                  <div className="menu-anchor">
                    <button
                      className={cn(
                        "ctrl-btn",
                        openMenu === "speed" && "active",
                      )}
                      onClick={() =>
                        setOpenMenu(openMenu === "speed" ? null : "speed")
                      }
                      title="Playback speed"
                    >
                      <Gauge size={18} />
                      <span className="ctrl-label">{rate}x</span>
                    </button>
                    {openMenu === "speed" && (
                      <div className="control-menu speed-menu">
                        <span className="control-menu-title">
                          Playback speed
                        </span>
                        {SPEEDS.map((speed) => (
                          <button
                            key={speed}
                            className={cn(
                              "control-menu-item",
                              speed === rate && "active",
                            )}
                            onClick={() => changeRate(speed)}
                          >
                            {speed === 1 ? "Normal" : `${speed}x`}
                            {speed === rate && <Check size={14} />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="menu-anchor">
                    <button
                      className={cn(
                        "ctrl-btn",
                        captionsOn && "active",
                        openMenu === "captions" && "open",
                      )}
                      onClick={() =>
                        setOpenMenu(openMenu === "captions" ? null : "captions")
                      }
                      title="Subtitles (C)"
                    >
                      <Captions size={18} />
                    </button>
                    {openMenu === "captions" && (
                      <div className="control-menu captions-menu">
                        <span className="control-menu-title">Subtitles</span>
                        <button
                          className={cn(
                            "control-menu-item",
                            !captionsOn && "active",
                          )}
                          onClick={() => {
                            setCaptionsOn(false);
                            setOpenMenu(null);
                          }}
                        >
                          Off
                          {!captionsOn && <Check size={14} />}
                        </button>
                        {subtitles.length === 0 && (
                          <span className="control-menu-empty">
                            No subtitle files found
                          </span>
                        )}
                        {subtitles.map((subtitle) => {
                          const unsupported = /\.(ass|ssa)$/i.test(
                            subtitle.path,
                          );
                          return (
                            <button
                              key={subtitle.path}
                              className={cn(
                                "control-menu-item",
                                captionsOn &&
                                  selectedSubtitle === subtitle.path &&
                                  "active",
                                unsupported && "disabled",
                              )}
                              onClick={() => {
                                openSubtitle(subtitle);
                                setOpenMenu(null);
                              }}
                              title={
                                unsupported
                                  ? "ASS/SSA is not supported"
                                  : subtitle.name
                              }
                            >
                              <span className="sub-name">{subtitle.name}</span>
                              {subtitle.matched && (
                                <span className="sub-tag">match</span>
                              )}
                              {captionsOn &&
                                selectedSubtitle === subtitle.path && (
                                  <Check size={14} />
                                )}
                            </button>
                          );
                        })}
                        <button
                          className="control-menu-item"
                          onClick={() => {
                            setOpenMenu(null);
                            addSubtitleFile();
                          }}
                        >
                          <Plus size={14} /> Add subtitle file...
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    className="ctrl-btn"
                    onClick={togglePictureInPicture}
                    title="Picture in picture (P)"
                  >
                    <PictureInPicture2 size={18} />
                  </button>
                  <button
                    className="ctrl-btn"
                    onClick={toggleFullscreen}
                    title="Fullscreen (F)"
                  >
                    {isFullscreen ? (
                      <Minimize2 size={18} />
                    ) : (
                      <Maximize size={18} />
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="player-headline">
            <div className="player-headline-main">
              <h1>{lecture.title}</h1>
              <div className="chip-row">
                <span className="chip ghost">{section?.title}</span>
                <span className="chip">
                  {pluralize(flat.length, "lecture")} ·{" "}
                  {formatHours(courseTime.totalDuration)}
                </span>
                {completed && (
                  <span className="chip success">
                    <CheckCircle2 size={12} /> Completed
                  </span>
                )}
                {review && (
                  <span className="chip warn">
                    <Flag size={12} /> Review later
                  </span>
                )}
              </div>
            </div>
            <div className="player-headline-actions">
              <button
                className={cn(
                  "btn btn-ghost btn-sm",
                  review && "is-active-warn",
                )}
                onClick={() => applyReview(!review)}
                title="Save this lecture for review later"
              >
                <Flag size={15} fill={review ? "currentColor" : "none"} />
                {review ? "Review later" : "Mark for review"}
              </button>
              <button
                className={cn(
                  "btn btn-sm",
                  completed ? "btn-success" : "btn-primary",
                )}
                onClick={() => applyCompleted(!completed)}
              >
                {completed ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                {completed ? "Completed" : "Mark complete"}
              </button>
            </div>
          </div>

          <div className="player-strip">
            <button
              className="player-nav-btn"
              onClick={() => prevEntry && onNavigate(prevEntry.lecture.id)}
              disabled={!prevEntry}
            >
              <ChevronLeft size={17} />
              <span className="nav-btn-text">
                <span>Previous</span>
                <strong>{prevEntry?.lecture.title ?? "Start of course"}</strong>
              </span>
            </button>

            <div className="player-strip-progress">
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${courseProgress}%` }}
                />
              </div>
              <span>
                {formatPercent(courseProgress)}% complete ·{" "}
                {formatHours(courseTime.watchedDuration)} of{" "}
                {formatHours(courseTime.totalDuration)} watched
              </span>
            </div>

            <button
              className="player-nav-btn align-right"
              onClick={() => nextEntry && onNavigate(nextEntry.lecture.id)}
              disabled={!nextEntry}
            >
              <span className="nav-btn-text">
                <span>Next</span>
                <strong>{nextEntry?.lecture.title ?? "End of course"}</strong>
              </span>
              <ChevronRight size={17} />
            </button>
          </div>

          <div className="player-tabs">
            {tabs.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  className={cn("tab-btn", activeTab === item.key && "active")}
                  onClick={() => setTab(item.key)}
                >
                  <Icon size={15} />
                  {item.label}
                  {item.count ? (
                    <span className="tab-count">{item.count}</span>
                  ) : null}
                </button>
              );
            })}
            <button
              className="tab-btn ghost"
              onClick={() => setShowShortcuts(true)}
            >
              <Keyboard size={15} /> Shortcuts
            </button>
          </div>

          <div className="tab-panel">
            {activeTab === "notes" && (
              <div className="notes-panel">
                <div className="note-composer">
                  <div className="composer-header">
                    <span>
                      <StickyNote size={15} /> New note
                    </span>
                    <button
                      className="timestamp-chip"
                      onClick={() => jumpTo(currentTime)}
                      title="Jump to this timestamp"
                    >
                      {formatTime(currentTime)}
                    </button>
                  </div>
                  <textarea
                    ref={noteInputRef}
                    className="note-input"
                    rows={3}
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        (event.ctrlKey || event.metaKey) &&
                        event.key === "Enter"
                      ) {
                        event.preventDefault();
                        addNote();
                      }
                    }}
                    placeholder="Summarize a concept, write a question, or capture an insight..."
                  />
                  <div className="composer-footer">
                    <span className="composer-hint">
                      Ctrl + Enter to save · Notes stick to the current
                      timestamp
                    </span>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={addNote}
                      disabled={!noteDraft.trim() || savingNote}
                    >
                      {savingNote ? (
                        <Loader2 size={14} className="spin" />
                      ) : (
                        <Plus size={14} />
                      )}
                      Save note
                    </button>
                  </div>
                </div>

                {notes.length === 0 ? (
                  <div className="tab-empty">
                    <StickyNote size={22} />
                    <h4>No notes for this lecture</h4>
                    <p>
                      Notes you take while watching are saved here with their
                      timestamp.
                    </p>
                  </div>
                ) : (
                  <div className="note-list">
                    {notes.map((note) => (
                      <article key={note.id} className="note-card">
                        <button
                          className="note-time"
                          onClick={() =>
                            note.timestamp !== null && jumpTo(note.timestamp)
                          }
                        >
                          {note.timestamp !== null
                            ? formatTime(note.timestamp)
                            : "No timestamp"}
                        </button>
                        {editingNoteId === note.id ? (
                          <div className="note-edit">
                            <textarea
                              rows={3}
                              value={editingNoteText}
                              onChange={(event) =>
                                setEditingNoteText(event.target.value)
                              }
                              autoFocus
                            />
                            <div className="note-edit-actions">
                              <button
                                className="btn btn-ghost btn-xs"
                                onClick={() => setEditingNoteId(null)}
                              >
                                Cancel
                              </button>
                              <button
                                className="btn btn-primary btn-xs"
                                onClick={() => saveNoteEdit(note)}
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p>{note.content}</p>
                            <div className="note-actions">
                              <button
                                className="icon-btn small"
                                onClick={() => {
                                  setEditingNoteId(note.id);
                                  setEditingNoteText(note.content);
                                }}
                                title="Edit note"
                              >
                                <FileText size={14} />
                              </button>
                              <button
                                className="icon-btn small danger-hover"
                                onClick={() => deleteNote(note)}
                                title="Delete note"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "moments" && (
              <div className="moments-panel">
                <div className="moment-composer">
                  <input
                    value={momentLabel}
                    onChange={(event) => setMomentLabel(event.target.value)}
                    placeholder={`Name this moment (${formatTime(currentTime)})...`}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") addMoment();
                    }}
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={addMoment}
                  >
                    <BookmarkPlus size={15} /> Save at {formatTime(currentTime)}
                  </button>
                </div>
                {moments.length === 0 ? (
                  <div className="tab-empty">
                    <Bookmark size={22} />
                    <h4>No saved moments yet</h4>
                    <p>
                      Mark the exact spot you want to revisit. Press B while
                      watching.
                    </p>
                  </div>
                ) : (
                  <div className="moment-list">
                    {moments.map((moment) => (
                      <div key={moment.id} className="moment-row">
                        <button
                          className="moment-time"
                          onClick={() =>
                            moment.timestamp !== null &&
                            jumpTo(moment.timestamp)
                          }
                        >
                          <Play size={12} fill="currentColor" />{" "}
                          {moment.timestamp !== null
                            ? formatTime(moment.timestamp)
                            : "0:00"}
                        </button>
                        <span className="moment-label">
                          {moment.description}
                        </span>
                        <button
                          className="icon-btn small danger-hover"
                          onClick={() => deleteMoment(moment)}
                          title="Remove moment"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "resources" && (
              <div className="resources-panel">
                {resources.length === 0 ? (
                  <div className="tab-empty">
                    <FileText size={22} />
                    <h4>No resources for this lecture</h4>
                    <p>
                      Files in the lecture folder appear here automatically
                      after a rescan.
                    </p>
                  </div>
                ) : (
                  <div className="resource-list">
                    {resources.map((resource) => (
                      <div key={resource} className="resource-row">
                        <span className="resource-icon">
                          {fileExtension(resource)}
                        </span>
                        <span className="resource-main">
                          <strong>{fileName(resource)}</strong>
                          <span>{fileExtension(resource)} file</span>
                        </span>
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => window.api.openPath(resource)}
                        >
                          <ArrowUpRight size={13} /> Open
                        </button>
                        <button
                          className="icon-btn small"
                          onClick={() => window.api.showInFolder(resource)}
                          title="Show in folder"
                        >
                          <FolderOpen size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "subtitles" && (
              <div className="subtitles-panel">
                <div className="subtitle-toggle-row">
                  <div>
                    <strong>Captions</strong>
                    <p>
                      SRT and VTT files play inline. ASS/SSA must be converted
                      first.
                    </p>
                  </div>
                  <button
                    className={cn("switch", captionsOn && "on")}
                    onClick={() => setCaptionsOn(!captionsOn)}
                    aria-label="Toggle captions"
                  >
                    <span />
                  </button>
                </div>
                <div className="subtitle-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={addSubtitleFile}
                  >
                    <Plus size={14} /> Add subtitle file
                  </button>
                  <span className="subtitle-hint">
                    Caption size and colors are in Settings → Playback.
                  </span>
                </div>
                {subtitles.length === 0 ? (
                  <div className="tab-empty">
                    <Captions size={22} />
                    <h4>No subtitles found</h4>
                    <p>
                      Place an .srt or .vtt file next to the video with the same
                      name.
                    </p>
                  </div>
                ) : (
                  <div className="subtitle-list">
                    {subtitles.map((subtitle) => {
                      const unsupported = /\.(ass|ssa)$/i.test(subtitle.path);
                      const active =
                        selectedSubtitle === subtitle.path && captionsOn;
                      return (
                        <button
                          key={subtitle.path}
                          className={cn(
                            "subtitle-row",
                            active && "active",
                            unsupported && "unsupported",
                          )}
                          onClick={() => openSubtitle(subtitle)}
                        >
                          <span className="subtitle-icon">
                            <Captions size={16} />
                          </span>
                          <span className="subtitle-main">
                            <strong>{subtitle.name}</strong>
                            <span>
                              {fileExtension(subtitle.path)}
                              {subtitle.matched ? " · matches this video" : ""}
                              {unsupported ? " · unsupported format" : ""}
                            </span>
                          </span>
                          {active ? (
                            <span className="chip tiny success">Playing</span>
                          ) : null}
                          <span className="subtitle-open">
                            <ArrowUpRight size={14} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <aside className="playlist-panel">
          <header className="playlist-header">
            <div className="playlist-title">
              <ListVideo size={17} />
              <strong>Course content</strong>
            </div>
            <span className="playlist-count">
              {completedCount}/{flat.length}
            </span>
          </header>
          <div className="playlist-progress">
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${courseProgress}%` }}
              />
            </div>
            <span>
              {formatPercent(courseProgress)}% ·{" "}
              {formatHours(courseTime.watchedDuration)}
            </span>
          </div>
          <div className="inline-search small">
            <Search size={14} />
            <input
              value={playlistQuery}
              onChange={(event) => setPlaylistQuery(event.target.value)}
              placeholder="Find a lecture..."
            />
          </div>

          <div className="playlist-scroll" ref={playlistScrollRef}>
            {playlistSections.length === 0 && (
              <div className="playlist-empty">
                No lectures match your search.
              </div>
            )}
            {playlistSections.map((playlistSection) => {
              const collapsed =
                !sectionExpansion.isExpanded(playlistSection.id) &&
                !playlistQuery.trim();
              const sectionCompleted = playlistSection.lectures.filter((row) =>
                isComplete(row),
              ).length;
              return (
                <div className="playlist-section" key={playlistSection.id}>
                  <button
                    className="playlist-section-head"
                    onClick={() => sectionExpansion.toggle(playlistSection.id)}
                  >
                    <ChevronDown
                      size={14}
                      className={cn(
                        "section-chevron",
                        collapsed && "collapsed",
                      )}
                    />
                    <span>{playlistSection.title}</span>
                    <span className="playlist-section-meta">
                      {sectionCompleted}/{playlistSection.lectures.length}
                    </span>
                  </button>

                  {!collapsed &&
                    playlistSection.lectures.map((row) => {
                      const isCurrent = row.id === lecture.id;
                      const done = isComplete(row);
                      const percent = lecturePercent(row);
                      return (
                        <div
                          key={row.id}
                          ref={isCurrent ? currentRowRef : undefined}
                          className={cn(
                            "playlist-item",
                            isCurrent && "current",
                            done && "done",
                          )}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            if (!isCurrent) onNavigate(row.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              if (!isCurrent) onNavigate(row.id);
                            }
                          }}
                        >
                          <span
                            className={cn(
                              "playlist-status",
                              done && "complete",
                            )}
                          >
                            {isCurrent ? (
                              playing ? (
                                <span className="playing-bars">
                                  <i />
                                  <i />
                                  <i />
                                </span>
                              ) : (
                                <Play size={13} fill="currentColor" />
                              )
                            ) : done ? (
                              <CheckCircle2 size={15} />
                            ) : (
                              <Circle size={15} />
                            )}
                          </span>
                          <span className="playlist-item-main">
                            <span className="playlist-item-title">
                              {row.title}
                            </span>
                            <span className="playlist-item-meta">
                              {done
                                ? "Completed"
                                : percent > 0
                                  ? `${formatPercent(percent)}% watched`
                                  : "Not started"}
                              {row.needs_review === 1 ? " · Review" : ""}
                            </span>
                            {percent > 0 && !done && (
                              <span className="mini-progress">
                                <span style={{ width: `${percent}%` }} />
                              </span>
                            )}
                          </span>
                          {row.needs_review === 1 && (
                            <Flag size={11} className="playlist-flag" />
                          )}
                        </div>
                      );
                    })}
                </div>
              );
            })}
          </div>
        </aside>
      </div>

      <Modal
        open={showShortcuts}
        title="Keyboard shortcuts"
        description="Everything is one keystroke away while a lecture is open."
        width={560}
        onClose={() => setShowShortcuts(false)}
      >
        <div className="shortcut-grid">
          {[
            ["Space / K", "Play or pause"],
            ["← / →", "Seek 5 seconds"],
            ["J / L", "Seek 10 seconds"],
            ["Shift + ← / →", "Seek 30 seconds"],
            ["↑ / ↓", "Volume up or down"],
            ["M", "Mute"],
            ["F / F11", "Fullscreen"],
            ["P", "Picture in picture"],
            ["C", "Toggle captions"],
            ["B", "Save a moment"],
            ["N", "Focus notes"],
            ["Shift + N", "Next lecture"],
            ["[ / ]", "Playback speed"],
            ["?", "This shortcut list"],
          ].map(([keys, description]) => (
            <div className="shortcut-row" key={keys}>
              <span className="shortcut-keys">{keys}</span>
              <span>{description}</span>
            </div>
          ))}
        </div>
      </Modal>

      <Modal
        open={showCompletion}
        title="Lecture complete"
        description={lecture.title}
        width={480}
        onClose={() => setShowCompletion(false)}
      >
        <div className="completion-summary">
          <div className="completion-hero">
            <CheckCircle2 size={34} />
            <h3>Nice work!</h3>
            <p>You have completed this lecture.</p>
          </div>
          <div className="completion-stats">
            <div>
              <span>Duration</span>
              <strong>{formatTime(duration)}</strong>
            </div>
            <div>
              <span>Studied</span>
              <strong>{formatTime(completionWatchedRef.current || duration)}</strong>
            </div>
            <div>
              <span>Notes</span>
              <strong>{notes.length}</strong>
            </div>
            <div>
              <span>Moments</span>
              <strong>{moments.length}</strong>
            </div>
          </div>
          <div className="ended-actions">
            <button
              className="btn btn-ghost"
              onClick={() => setShowCompletion(false)}
            >
              Keep watching
            </button>
            {nextEntry && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  setShowCompletion(false);
                  onNavigate(nextEntry.lecture.id);
                }}
              >
                Next lecture <ChevronRight size={15} />
              </button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
