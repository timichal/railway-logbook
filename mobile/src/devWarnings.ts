/**
 * Keeps React Native's "Open debugger to view warnings." toast off the screen.
 *
 * Since RN 0.77 a warning is shown neither in LogBox nor in Metro's terminal, only
 * in React Native DevTools (`j` in the Metro terminal). With no DevTools attached,
 * the first warning puts up that toast instead, and tapping it opens DevTools on
 * the Mac. Here it renders blank, with no close button, over the tab bar, and it
 * stays until DevTools connects (LogBox's own JSX goes through NativeWind's runtime,
 * which is the likely reason). The toast is the only thing a warning still puts in
 * LogBox, so ignoring its text hides it and hides no warning. Errors and the red
 * error screen are untouched.
 *
 * An ignore pattern also drops a log already shown (`LogBoxData.addIgnorePatterns`
 * re-filters), so this works whenever it runs.
 */
import { LogBox } from "react-native";

LogBox.ignoreLogs(["Open debugger to view warnings."]);
