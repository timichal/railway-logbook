/**
 * Where the keyboard's top edge is on screen (window coordinates), or null while it
 * is down.
 *
 * For something floating over a screen that doesn't move for the keyboard, such as
 * the map's search box: iOS lays the keyboard over the window, so whatever runs
 * down to the bottom edge ends up behind it. Android resizes the window instead
 * (edge-to-edge or not, the content is laid out above the keyboard), so there the
 * top is reported but the layout has already made room, and comparing it with a
 * measured bottom edge comes out as no overlap.
 *
 * iOS's `will` events, so the box moves with the keyboard rather than after it;
 * Android only has `did`.
 */
import { useEffect, useState } from "react";
import { Keyboard, type KeyboardEvent, Platform } from "react-native";

export function useKeyboardTop(): number | null {
  const [top, setTop] = useState<number | null>(() =>
    Keyboard.isVisible() ? (Keyboard.metrics()?.screenY ?? null) : null,
  );

  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(
      ios ? "keyboardWillChangeFrame" : "keyboardDidShow",
      (event: KeyboardEvent) => setTop(event.endCoordinates.screenY),
    );
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () =>
      setTop(null),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return top;
}
