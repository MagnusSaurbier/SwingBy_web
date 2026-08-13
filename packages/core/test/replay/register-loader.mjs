// T-02 TAPE — registers resolve-hook.mjs. See that file's header comment for why this exists.
// Usage: node --experimental-strip-types --import ./register-loader.mjs <script>.ts
import { register } from "node:module";

register("./resolve-hook.mjs", import.meta.url);
