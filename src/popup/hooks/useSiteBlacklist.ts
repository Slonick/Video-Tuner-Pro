// The per-site kill switch for the open tab's domain. `rule` is the stored entry that
// switches the extension off here (the domain itself or a parent of it), else null.
// Kept live so an edit on the options page reaches the open popup.
import { useCallback, useState } from "react";
import { STORE } from "../platform/storage.js";
import { useStored } from "./useStored.js";
import {
  SITE_BLACKLIST_KEY,
  normalizeSiteList,
  matchingSite,
  blockSite,
  allowSite,
} from "../../shared/site-blacklist.js";

export interface UseSiteBlacklist {
  rule: string | null;
  setDisabled: (off: boolean) => void;
}

export function useSiteBlacklist(domain: string): UseSiteBlacklist {
  const [list, setList] = useState<string[]>([]);
  useStored([SITE_BLACKLIST_KEY], (r) => setList(normalizeSiteList(r[SITE_BLACKLIST_KEY])));

  // Read-modify-write against the freshest stored list, not the rendered one — the
  // options page may have edited it since the popup loaded.
  const setDisabled = useCallback(
    (off: boolean) => {
      if (!domain) return;
      STORE.get([SITE_BLACKLIST_KEY], (r) => {
        const cur = normalizeSiteList(r[SITE_BLACKLIST_KEY]);
        const next = off ? blockSite(cur, domain) : allowSite(cur, domain);
        setList(next);
        STORE.set({ [SITE_BLACKLIST_KEY]: next });
      });
    },
    [domain],
  );

  return { rule: matchingSite(domain, list), setDisabled };
}
