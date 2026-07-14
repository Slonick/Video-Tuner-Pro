export const SPONSOR_DATA_PERMISSION = "browsingActivity";

interface DataCollectionSpec {
  data_collection: string[];
}

interface GrantedPermissions {
  data_collection?: string[];
}

interface FirefoxPermissionsApi {
  getAll(): Promise<GrantedPermissions>;
  request(permissions: DataCollectionSpec): Promise<boolean>;
  remove(permissions: DataCollectionSpec): Promise<boolean>;
}

function firefoxPermissions(): FirefoxPermissionsApi | null {
  const browser = (
    globalThis as {
      browser?: {
        permissions?: unknown;
        runtime?: { getManifest?: () => Record<string, unknown> };
      };
    }
  ).browser;
  const manifest = browser?.runtime?.getManifest?.();
  const browserSettings = manifest?.browser_specific_settings;
  if (
    !browserSettings ||
    typeof browserSettings !== "object" ||
    !(browserSettings as { gecko?: unknown }).gecko
  ) {
    return null;
  }
  const candidate = browser?.permissions;
  if (!candidate || typeof candidate !== "object") return null;
  const permissions = candidate as Partial<FirefoxPermissionsApi>;
  if (
    typeof permissions.getAll !== "function" ||
    typeof permissions.request !== "function" ||
    typeof permissions.remove !== "function"
  ) {
    return null;
  }
  return permissions as FirefoxPermissionsApi;
}

// Chrome has no Firefox data-collection permission API. Its consent is the
// explicit, off-by-default toggle plus the store/UI disclosure.
export async function hasSponsorDataConsent(): Promise<boolean> {
  const permissions = firefoxPermissions();
  if (!permissions) return true;
  try {
    const granted = await permissions.getAll();
    return granted.data_collection?.includes(SPONSOR_DATA_PERMISSION) === true;
  } catch {
    return false;
  }
}

// Called directly from the switch event so Firefox can attach its native prompt
// to a user gesture.
export async function requestSponsorDataConsent(): Promise<boolean> {
  const permissions = firefoxPermissions();
  if (!permissions) return true;
  try {
    return await permissions.request({ data_collection: [SPONSOR_DATA_PERMISSION] });
  } catch {
    return false;
  }
}

export async function removeSponsorDataConsent(): Promise<boolean> {
  const permissions = firefoxPermissions();
  if (!permissions) return true;
  try {
    return await permissions.remove({ data_collection: [SPONSOR_DATA_PERMISSION] });
  } catch {
    return false;
  }
}
