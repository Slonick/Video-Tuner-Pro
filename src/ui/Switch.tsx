// The popup/options on/off switch as a controlled React component. Markup +
// classes match the original .switch/.switch-track/.switch-knob CSS exactly.
interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
}

export function Switch({ checked, onChange, disabled, id }: Props) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        className="switch-input"
        id={id}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch-track">
        <span className="switch-knob"></span>
      </span>
    </label>
  );
}
