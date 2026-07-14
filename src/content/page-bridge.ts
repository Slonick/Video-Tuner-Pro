// These hooks must run in MAIN world at document_start on every frame. Bundling
// them together avoids parsing two separate universal scripts on every page.
import "./quality-loader.js";
import "./audio-inject.js";
import { SHADOW_ROOT_ATTACHED_EVENT } from "../shared/dom-events.js";

// attachShadow() does not create a DOM mutation. Dynamic web-component players
// (Boosty is one) can therefore attach their root after the isolated content
// script has already scanned the host and remain invisible until its slow
// reconcile timer. Signal open roots synchronously so the content script can
// observe the still-empty root before the page appends its <video>.
const bridgeWindow = window as typeof window & { __vtpShadowAttachBridge?: boolean };
if (!bridgeWindow.__vtpShadowAttachBridge) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "attachShadow");
    const nativeAttachShadow = descriptor?.value as Element["attachShadow"] | undefined;
    if (descriptor && typeof nativeAttachShadow === "function") {
      // A Proxy preserves the native function's name/length and native-looking
      // Function#toString result, reducing the chance of upsetting site probes.
      const bridgedAttachShadow = new Proxy(nativeAttachShadow, {
        apply(target, thisArg, args) {
          const root = Reflect.apply(target, thisArg, args) as ShadowRoot;
          if (root.mode === "open") {
            try {
              root.host.dispatchEvent(
                new Event(SHADOW_ROOT_ATTACHED_EVENT, { bubbles: true, composed: true }),
              );
            } catch (e) {
              /* diagnostics must never interfere with the page's player */
            }
          }
          return root;
        },
      });
      Object.defineProperty(Element.prototype, "attachShadow", {
        ...descriptor,
        value: bridgedAttachShadow,
      });
      bridgeWindow.__vtpShadowAttachBridge = true;
    }
  } catch (e) {
    /* periodic reconcile remains the safe fallback on locked-down pages */
  }
}
