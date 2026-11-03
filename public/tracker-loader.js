// Native module entry served as-is, matching the compiler frame's vendor loading pattern.
// Loading through a module script avoids bundler transforms on the pinned public vendor files.
import './vendor/mindar-1.2.5/mindar-image.prod.js';
