// DriveImages.js - Drive attachment lookup and image URLs.
// Apps Script server files share one global scope; no imports are required.

// =============================================
// DRIVE FILE CACHE & IMAGE URL UTILITIES
//
// Apps Script resets ALL global variables on every new execution,
// so a module-level cache variable would always be null at the start
// of each request — it cannot persist between separate function calls.
//
// Instead, buildDriveFileCache() is called ONCE per function execution
// and the resulting object is passed directly to wherever it's needed.
// This still avoids redundant Drive API calls within a single run
// (e.g. getSheetData and getCIRData both use the same cache object
// if called from a shared entry point).
//
// PERFORMANCE NOTE:
// DriveApp.getFiles() iterates your ENTIRE Drive. If you have thousands
// of files this may approach the 6-minute execution limit. To scope it
// to a specific folder instead, replace DriveApp.getFiles() with:
//
//   DriveApp.getFolderById('YOUR_FOLDER_ID').getFiles()
//
// Get the folder ID from the URL when you open the folder in Drive:
//   drive.google.com/drive/folders/YOUR_FOLDER_ID
// =============================================
function buildDriveFileCache() {
  const cache = {};
  const files = DriveApp.getFiles();   // ← swap for folder-scoped if needed

  while (files.hasNext()) {
    const file = files.next();
    cache[file.getName()] = file.getId();
  }

  return cache;
}

function extractFileName(path) {
  if (!path) return '';
  return path.split('/').pop().trim();
}

function pathToImageUrl(path, cache) {
  if (!path || !cache) return '';
  const fileName = extractFileName(path);
  const fileId   = cache[fileName];
  return fileId ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000` : '';
}

