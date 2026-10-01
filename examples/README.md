# Examples (placeholders only)

These files show the shape of the **private** configuration the tools write for
you. They contain no real values. Never put real credentials in this folder;
real files live in `private/`, which is ignored by Git and excluded from release
archives.

| Example                 | Real file (created by)                            | Purpose                                                                                                 |
| ----------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `runtime.example.json`  | `private/runtime.json` (`npm run setup`)          | Selects connected mode, holds the **public** Firebase web configuration and the _path_ to the Admin key |
| `presence.example.json` | `private/presence.json` (`npm run esp32:prepare`) | ESP32 device identity, classroom Wi-Fi and the shared signing secret                                    |

The Firebase Admin key (`private/firebase-service-account.json`) is downloaded
from the Firebase Console and is never copied, pasted or committed.
