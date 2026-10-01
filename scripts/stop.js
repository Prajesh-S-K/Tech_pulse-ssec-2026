// `npm run stop` — stops every Tech Pulse process started from this folder.
import { stopOurs } from "./lib/instances.js";
const n = await stopOurs();
console.log(
  n
    ? `Stopped ${n} Tech Pulse process(es).`
    : "No Tech Pulse process is running from this folder.",
);
