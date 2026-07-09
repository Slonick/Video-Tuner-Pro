// These hooks must run in MAIN world at document_start on every frame. Bundling
// them together avoids parsing two separate universal scripts on every page.
import "./quality-loader.js";
import "./audio-inject.js";
