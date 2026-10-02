// Code.js - Web app entry point and HTML include helper.
// Apps Script server files share one global scope; no imports are required.

// =============================================
// doGet
// =============================================
function doGet(e) {
  return HtmlService.createTemplateFromFile('frontend/Index')
    .evaluate()
    .setTitle('IBMS — Integrated Branch Management System')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

// Raw content of a frontend partial, for <?!= include('frontend/css/Base'); ?>
// lines in frontend/Index.html. Partials contain no scriptlets.
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
