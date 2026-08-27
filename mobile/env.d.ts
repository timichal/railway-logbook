/**
 * The ambient declarations the bundler's non-JS imports need — `global.css` above
 * all, which is a side-effect import with no module behind it.
 *
 * Written by hand rather than left to Expo: SDK 57 deletes the `expo-env.d.ts` it
 * used to generate and rewrites `tsconfig.json#include` on every `expo run`, so a
 * generated file is not something the typecheck can depend on.
 */
/// <reference types="expo/types" />
/// <reference types="nativewind/types" />
