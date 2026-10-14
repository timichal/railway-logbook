interface SidebarResizerProps {
  onMouseDown: () => void;
  isResizing: boolean;
}

/** The desktop sidebar's drag handle (`useResizableSidebar`). */
export default function SidebarResizer({ onMouseDown, isResizing }: SidebarResizerProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: mouse-only resize affordance with no keyboard equivalent; the sidebar remains fully usable without resizing.
    <div
      onMouseDown={onMouseDown}
      className={`w-1 bg-gray-200 hover:bg-blue-400 cursor-col-resize flex-shrink-0 ${isResizing ? "bg-blue-400" : ""}`}
      style={{ userSelect: "none" }}
    />
  );
}
