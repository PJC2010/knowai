// Let Node unit tests import server modules without changing production guards.
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "server-only") return {url:"data:text/javascript,export {}",shortCircuit:true};
  return next(specifier,context);
} });
