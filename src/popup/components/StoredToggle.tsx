// A Switch bound to a stored boolean flag (showRemaining / streamBadge / keyboard
// / superTheater) — so the cards don't each re-wire useStoredFlag + Switch.
import { Switch } from "../../ui/Switch.js";
import { useStoredFlag } from "../hooks/storage.js";

interface Props {
  id: string;
  storageKey: string;
  defaultOn: boolean;
}

export function StoredToggle({ id, storageKey, defaultOn }: Props) {
  const [on, setOn] = useStoredFlag(storageKey, defaultOn);
  return <Switch id={id} checked={on} onChange={setOn} />;
}
