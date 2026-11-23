/**
 * MapLibre Native's log, with a lost connection demoted from error to warning.
 *
 * The binding forwards the native log to the console (`LogManager`), errors as
 * `console.error`, which a development build shows as a red LogBox toast. A tile,
 * glyph or sprite request that fails for want of a network is logged at error level,
 * so coming back to the app offline put up "The Internet connection appears to be
 * offline." over a map that was fine: MapLibre keeps what it has and tries again
 * when the connection returns. Those go to `console.warn` (React Native DevTools)
 * instead. Any other MapLibre error, a server answering 500 included, stays an error.
 *
 * A release build has no LogBox, so this changes what a developer sees, not a user.
 */
import { LogManager } from "@maplibre/maplibre-react-native";

/** iOS's NSURLError descriptions and Android's (OkHttp) for having no usable network. */
const NO_CONNECTION =
  /offline|connection was lost|timed out|timeout|could not connect|failed to connect|hostname could not be found|unable to resolve host|connection abort|not currently allowed|network is unreachable|connection reset|connection refused/i;

LogManager.onLog(({ level, tag, message }) => {
  if (level !== "error" || !NO_CONNECTION.test(message)) return false;
  console.warn(`MapLibre Native [ERROR → warn: no connection] [${tag}] ${message}`);
  return true;
});
