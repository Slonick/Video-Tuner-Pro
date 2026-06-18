// Popup header: title + version, the gear that opens the options page, and the
// Ko-fi link.
import { api } from "../platform/browser.js";
import { msg } from "../i18n.js";
import { GearIcon, KofiIcon } from "../icons.js";

export function Header() {
  const version = api.runtime.getManifest().version;
  return (
    <div className="header">
      <h1>
        <span>{msg("appHeader")}</span>
        <span className="pro-badge">PRO</span>
        <span className="version" id="extVersion">
          {"v" + version}
        </span>
      </h1>
      <div className="header-actions">
        <button
          type="button"
          className="icon-btn"
          id="openOptions"
          aria-label="Settings"
          title={msg("optHeader")}
          onClick={() => api.runtime.openOptionsPage()}
        >
          <GearIcon />
        </button>
        <a
          className="kofi"
          href="https://ko-fi.com/slonick"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Support the project on Ko-fi"
          title="Support the project ☕"
        >
          <KofiIcon />
        </a>
      </div>
    </div>
  );
}
