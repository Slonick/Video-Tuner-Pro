// Which platforms have viewer chat, and how to reach it. The per-platform
// popout-chat URL builders live in this one file, so a URL-scheme change (or a
// new platform, e.g. Boosty) is a change here only.
import { currentSiteLogin } from "../channel.js";
import { isYouTube, youTubeVideoId } from "../markers.js";

export type ChatPlatform = "twitch" | "youtube" | "kick";

const TWITCH_HOST = /(^|\.)twitch\.tv$/i;
const KICK_HOST = /(^|\.)kick\.com$/i;

export function chatPlatform(hostname: string = location.hostname): ChatPlatform | null {
  if (TWITCH_HOST.test(hostname)) return "twitch";
  if (KICK_HOST.test(hostname)) return "kick";
  if (isYouTube(hostname)) return "youtube";
  return null;
}

// The platform's native popout chat for the current page, embedded as-is in side
// mode (same-origin relative to the page, so the user's login cookies apply and
// they can write). Null when the page doesn't identify a channel/video.
// Twitch alternative if the popout route ever refuses framing:
// /embed/<login>/chat?parent=www.twitch.tv
export function sideChatUrl(): string | null {
  switch (chatPlatform()) {
    case "twitch": {
      const login = currentSiteLogin();
      return login ? `https://www.twitch.tv/popout/${login}/chat?darkpopout` : null;
    }
    case "kick": {
      const login = currentSiteLogin();
      return login ? `https://kick.com/popout/${login}/chat` : null;
    }
    case "youtube": {
      // Channel-live URLs (/@handle/live) carry no id — the watch page's
      // ytd-watch-flexy element does.
      const id =
        youTubeVideoId() ?? document.querySelector("ytd-watch-flexy")?.getAttribute("video-id");
      return id ? `https://www.youtube.com/live_chat?is_popout=1&v=${id}` : null;
    }
    default:
      return null;
  }
}
