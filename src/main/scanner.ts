import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { probeVideoDuration } from './media';
const naturalCompare = require('natural-compare');

const VIDEO_EXTS = ['.mp4', '.mkv', '.webm', '.mov', '.avi'];
const SUB_EXTS = ['.srt', '.vtt', '.ass', '.ssa'];
const RES_EXTS = ['.pdf', '.txt', '.md', '.json', '.js', '.py', '.html', '.css'];

function isVideo(f: string) { return VIDEO_EXTS.includes(path.extname(f).toLowerCase()); }
function isSub(f: string) { return SUB_EXTS.includes(path.extname(f).toLowerCase()); }
function isResource(f: string) { return RES_EXTS.includes(path.extname(f).toLowerCase()); }

function naturalSort(a: string, b: string) { return naturalCompare(a, b); }

export function scanCourseFolder(folderPath: string) {
  const courseTitle = path.basename(folderPath);
  const sections: any[] = [];
  
  // Try to read top level entries
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  
  // Check if there are video files directly in root (flat structure)
  const rootVideos = entries.filter(e => e.isFile() && isVideo(e.name)).sort((a,b)=>naturalSort(a.name,b.name));
  const rootSubs = entries.filter(e => e.isFile() && isSub(e.name));
  const rootResources = entries.filter(e => e.isFile() && isResource(e.name));
  
  if (rootVideos.length > 0 && sections.length === 0) {
    // Create a default section for flat structure
    const lectures = rootVideos.map((v, idx) => {
      const base = path.basename(v.name, path.extname(v.name));
      const subs = findMatchingSubs(v.name, base, rootSubs);
      return {
        id: uuidv4(),
        title: base.replace(/^\d+\s*[-_.]\s*/, '').replace(/_/g, ' '),
        file_path: path.join(folderPath, v.name),
        duration: probeVideoDuration(path.join(folderPath, v.name)),
        order_index: idx,
        subtitle_paths: JSON.stringify(subs.map(s => path.join(folderPath, s))),
        resources: JSON.stringify([])
      };
    });
    sections.push({
      id: uuidv4(),
      title: 'Lectures',
      order_index: 0,
      lectures
    });
  }
  
  // Scan subdirectories as sections
  const dirs = entries.filter(e => e.isDirectory() && e.name !== '__MACOSX').sort((a,b)=>naturalSort(a.name,b.name));
  for (let di = 0; di < dirs.length; di++) {
    const dirName = dirs[di].name;
    const dirPath = path.join(folderPath, dirName);
    const subEntries = fs.readdirSync(dirPath, { withFileTypes: true });
    const videos = subEntries.filter(e => e.isFile() && isVideo(e.name)).sort((a,b)=>naturalSort(a.name,b.name));
    const subs = subEntries.filter(e => e.isFile() && isSub(e.name));
    const resources = subEntries.filter(e => e.isFile() && isResource(e.name)).map(r=>path.join(dirPath, r.name));
    
    if (videos.length > 0) {
      const lectures = videos.map((v, idx) => {
        const base = path.basename(v.name, path.extname(v.name));
        const matchingSubs = findMatchingSubs(v.name, base, subs.map(s=>s.name));
        return {
          id: uuidv4(),
          title: base.replace(/^\d+\s*[-_.]\s*/, '').replace(/_/g, ' '),
          file_path: path.join(dirPath, v.name),
          duration: probeVideoDuration(path.join(dirPath, v.name)),
          order_index: idx,
          subtitle_paths: JSON.stringify(matchingSubs.map(s=>path.join(dirPath, s))),
          resources: JSON.stringify(resources)
        };
      });
      sections.push({
        id: uuidv4(),
        title: dirName.replace(/^\d+\s*[-_.]\s*/, '').replace(/_/g, ' '),
        order_index: sections.length,
        lectures
      });
    }
  }
  
  // If we have root videos and also added dirs? Merge carefully - if root had videos we already added default section
  // but also check if there might be case where both exist; our logic adds default if root videos and no sections added yet
  // Re-scan logic: better approach - collect all sections
  if (sections.length === 0 && rootVideos.length === 0) {
    // try deep scan
    const allVideos: any[] = [];
    function walk(d: string, rel='') {
      const ents = fs.readdirSync(d, { withFileTypes: true });
      for (const e of ents) {
        if (e.isDirectory() && e.name !== '__MACOSX') walk(path.join(d,e.name), path.join(rel,e.name));
        else if (e.isFile() && isVideo(e.name)) {
          allVideos.push({ full: path.join(d,e.name), rel, name: e.name });
        }
      }
    }
    walk(folderPath);
    allVideos.sort((a,b)=>naturalSort(a.rel+a.name, b.rel+b.name));
    if (allVideos.length > 0) {
      const lectures = allVideos.map((v, idx) => ({
        id: uuidv4(),
        title: path.basename(v.name, path.extname(v.name)).replace(/^\d+\s*[-_.]\s*/, '').replace(/_/g,' '),
        file_path: v.full,
        duration: probeVideoDuration(v.full),
        order_index: idx,
        subtitle_paths: JSON.stringify([]),
        resources: JSON.stringify([])
      }));
      sections.push({ id: uuidv4(), title: 'Lectures', order_index: 0, lectures });
    }
  }
  
  return { courseTitle, sections };
}

function findMatchingSubs(videoName: string, base: string, subs: any[]) {
  const results: string[] = [];
  const subNames: string[] = Array.isArray(subs) ? subs.map((s:any)=>typeof s === 'string' ? s : s.name) : [];
  for (const sn of subNames) {
    const sbase = path.basename(sn, path.extname(sn));
    if (sbase === base || sbase.includes(base) || base.includes(sbase)) {
      results.push(sn);
    }
  }
  // also check case-insensitive
  if (results.length === 0) {
    for (const sn of subNames) {
      if (sn.toLowerCase().startsWith(base.toLowerCase())) results.push(sn);
    }
  }
  return results;
}

export function listSubtitlesForVideo(videoPath: string) {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  try {
    const ents = fs.readdirSync(dir, { withFileTypes: true });
    const subs = ents.filter(e=>e.isFile() && isSub(e.name));
    const matches = findMatchingSubs(path.basename(videoPath), base, subs.map(s=>s.name));
    const all = subs.map(s=>({ name: s.name, path: path.join(dir, s.name), matched: matches.includes(s.name) }));
    return all;
  } catch {
    return [];
  }
}
