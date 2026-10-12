// Per-segment boundary: navigating between sibling sections keeps the
// workspace layout (and its loading boundary) mounted, so each page needs its
// own <Suspense> for the App Shell to render instantly while data streams.
export { default } from "../../../loading";
