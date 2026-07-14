type ExtensionApi = typeof chrome;

type ExtensionGlobals = typeof globalThis & {
  browser?: ExtensionApi;
  chrome?: ExtensionApi;
};

function hasLiveRuntime(candidate: ExtensionApi | undefined): candidate is ExtensionApi {
  try {
    return (
      typeof candidate?.runtime?.id === "string" &&
      candidate.runtime.id.length > 0 &&
      typeof candidate.runtime.getURL === "function" &&
      typeof candidate.runtime.sendMessage === "function" &&
      typeof candidate.storage?.local?.get === "function"
    );
  } catch {
    return false;
  }
}

// Some ordinary web pages publish an unrelated global named `browser`. A bare
// `typeof browser !== "undefined"` check can therefore select a page object in a
// Chromium content script and make api.storage/runtime calls crash. Prefer an
// actual extension runtime, then retain the present global as a fallback so an
// orphaned script can still fail closed through ctxValid()/lastError checks.
export function getExtensionApi(): ExtensionApi {
  const root = globalThis as ExtensionGlobals;
  if (hasLiveRuntime(root.browser)) return root.browser;
  if (hasLiveRuntime(root.chrome)) return root.chrome;
  if (root.chrome) return root.chrome;
  if (root.browser) return root.browser;
  throw new Error("Extension API unavailable");
}
