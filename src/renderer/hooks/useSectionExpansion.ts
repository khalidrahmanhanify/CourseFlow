import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Expansion memory for course sections.
 *
 * Mainstream learning apps open only the section you are working in. Sections
 * you explicitly open stay open, and sections you close stay closed. The
 * "focus" section (current lecture in the player, next unfinished lecture in
 * the course view) is treated as open unless it was explicitly closed.
 */
interface SectionMemory {
  open: string[];
  closed: string[];
}

const EMPTY: SectionMemory = { open: [], closed: [] };

function storageKey(courseId: string) {
  return `courseflow.sections.${courseId}`;
}

function readMemory(courseId: string): SectionMemory {
  try {
    const raw = localStorage.getItem(storageKey(courseId));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    return {
      open: Array.isArray(parsed?.open) ? parsed.open.filter((id: unknown) => typeof id === 'string') : [],
      closed: Array.isArray(parsed?.closed) ? parsed.closed.filter((id: unknown) => typeof id === 'string') : []
    };
  } catch {
    return EMPTY;
  }
}

function writeMemory(courseId: string, memory: SectionMemory) {
  try {
    localStorage.setItem(storageKey(courseId), JSON.stringify(memory));
  } catch {
    // Storage can be unavailable; expansion just falls back to the default.
  }
}

export function useSectionExpansion(courseId: string, sectionIds: string[], focusSectionId: string | null) {
  const [memory, setMemory] = useState<SectionMemory>(() => readMemory(courseId));
  const previousKey = useRef(storageKey(courseId));
  const previousFocus = useRef(focusSectionId);
  const idsKey = sectionIds.join('|');

  // Load the remembered layout when switching courses.
  useEffect(() => {
    const key = storageKey(courseId);
    if (previousKey.current !== key) {
      previousKey.current = key;
      previousFocus.current = focusSectionId;
      setMemory(readMemory(courseId));
    }
  }, [courseId, focusSectionId]);

  // Navigating into a different section should reveal it even if it was
  // collapsed earlier, but the section you were just working in must stay open.
  // Otherwise finishing the last lecture of a long section collapses it and
  // pushes the list around, forcing you to scroll back up to it.
  useEffect(() => {
    if (!focusSectionId || focusSectionId === previousFocus.current) return;
    const previous = previousFocus.current;
    previousFocus.current = focusSectionId;
    setMemory((current) => {
      const open = new Set(current.open);
      const closed = new Set(current.closed);
      if (previous && sectionIds.includes(previous) && !closed.has(previous)) open.add(previous);
      closed.delete(focusSectionId);
      return { open: [...open], closed: [...closed] };
    });
  }, [focusSectionId, idsKey]);

  useEffect(() => {
    writeMemory(courseId, memory);
  }, [courseId, memory]);

  const expanded = useMemo(() => {
    const open = new Set(memory.open);
    const closed = new Set(memory.closed);
    return new Set(sectionIds.filter((id) => !closed.has(id) && (open.has(id) || id === focusSectionId)));
  }, [idsKey, memory, focusSectionId]);

  const isExpanded = useCallback((id: string) => expanded.has(id), [expanded]);

  const toggle = useCallback((id: string) => {
    setMemory((current) => {
      const open = new Set(current.open);
      const closed = new Set(current.closed);
      const isOpen = !closed.has(id) && (open.has(id) || id === focusSectionId);
      if (isOpen) {
        open.delete(id);
        closed.add(id);
      } else {
        closed.delete(id);
        open.add(id);
      }
      return { open: [...open], closed: [...closed] };
    });
  }, [focusSectionId]);

  const expandAll = useCallback(() => {
    setMemory({ open: [...sectionIds], closed: [] });
  }, [idsKey]);

  const collapseAll = useCallback(() => {
    setMemory({ open: [], closed: [...sectionIds] });
  }, [idsKey]);

  return { isExpanded, toggle, expandAll, collapseAll };
}
