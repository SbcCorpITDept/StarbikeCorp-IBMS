// Code.js - Web app entry point. See BACKEND_GUIDE.md for the backend file map.
// Apps Script server files share one global scope; no imports are required.

// =============================================
// doGet
// =============================================
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('IBMS \u2014 Integrated Branch Management System')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}
