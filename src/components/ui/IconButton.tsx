import type { ComponentProps } from "react";
import Icon, { type IconName } from "@/components/ui/Icon";
import { type IconButtonSize, type IconButtonTone, iconBtn } from "@/lib/ui/buttonStyles";

/** The glyph each button size draws, so the same size looks the same everywhere. */
const GLYPH_SIZES: Record<IconButtonSize, string> = {
  sm: "w-5 h-5",
  md: "w-6 h-6",
  responsive: "w-4 h-4",
};

/**
 * A label-less glyph button (`iconBtn`). Other button attributes (`disabled`,
 * `title`…) pass through; `className` is for layout only.
 */
export default function IconButton({
  icon,
  label,
  size = "md",
  tone,
  className,
  ...rest
}: Omit<ComponentProps<"button">, "type" | "children" | "aria-label"> & {
  icon: IconName;
  /** The accessible name, since the button shows no text. */
  label: string;
  size?: IconButtonSize;
  tone?: IconButtonTone;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={className ? `${iconBtn(size, tone)} ${className}` : iconBtn(size, tone)}
      {...rest}
    >
      <Icon name={icon} className={GLYPH_SIZES[size]} />
    </button>
  );
}
