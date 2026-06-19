// The popup/options on/off switch. Radix Switch gives the role="switch" semantics
// and keyboard handling; motion.dev springs the knob across. Classes (.switch /
// .switch-track / .switch-knob) match the existing CSS, now keyed off Radix's
// data-state instead of an :checked input sibling.
import * as RadixSwitch from "@radix-ui/react-switch";
import { m } from "motion/react";
import { controlSpring, useTransitionFor } from "./motion.js";

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
}

export function Switch({ checked, onChange, disabled, id }: Props) {
  return (
    <RadixSwitch.Root
      id={id}
      className="switch switch-track"
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
    >
      <RadixSwitch.Thumb asChild>
        <m.span
          className="switch-knob"
          initial={false}
          animate={{ x: checked ? 16 : 0 }}
          transition={useTransitionFor(controlSpring)}
        />
      </RadixSwitch.Thumb>
    </RadixSwitch.Root>
  );
}
