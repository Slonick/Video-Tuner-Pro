// A Switch bound to a stored boolean flag (showRemaining / streamBadge / keyboard
// / superTheater) — so the cards don't each re-wire useStoredFlag + Switch.
import { Switch } from "../../ui/Switch.js";
import { useStoredFlag } from "../hooks/storage.js";

interface Props {
  id: string;
  storageKey: string;
  defaultOn: boolean;
  ariaLabel?: string;
}

export function StoredToggle({ id, storageKey, defaultOn, ariaLabel }: Props) {
  const [on, setOn] = useStoredFlag(storageKey, defaultOn);
  return <Switch id={id} ariaLabel={ariaLabel} checked={on} onChange={setOn} />;
}
